import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { JwtPayload, RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { SecurityLogService } from '../../common/security/security-log.service';
import { TokenService } from '../../common/security/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityHub } from './community.hub';
import { CommunityService } from './community.service';

/** Pings a cada 30 s derrubam conexões mortas (aba fechada sem despedida) e revalidam a sessão. */
const PING_MS = 30_000;
/** O cliente só ouve: qualquer mensagem dele é lixo, e o limite pequeno corta abuso de memória. */
const MAX_PAYLOAD_BYTES = 1024;
const MAX_CONEXOES_POR_CONTA = 5;
/** Subprotocolo que leva o token: o navegador não manda cabeçalho no WebSocket e a URL vai para logs e histórico. */
export const WS_PROTOCOL = 'orbit.v1';

interface Conexao {
  userId: string;
  jti?: string;
  iat: number;
}

/**
 * `new WebSocket('ws://host/api/community/ws?gameId=…', ['orbit.v1', token])`.
 * O token vai no cabeçalho `Sec-WebSocket-Protocol`, nunca na URL. As mesmas
 * regras do `JwtAuthGuard` e do `CommunityAccessGuard` valem aqui, mais a
 * conferência de Origin; quem não passa recebe o status HTTP no upgrade.
 */
@Injectable()
export class CommunitySocketServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommunitySocketServer.name);
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  private readonly conexoes = new Map<WebSocket, Conexao>();
  private pinger?: NodeJS.Timeout;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly community: CommunityService,
    private readonly hub: CommunityHub,
    private readonly security: SecurityLogService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    const path = `/${this.config.getOrThrow<string>('app.prefix')}/community/ws`;

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '', 'http://localhost');
      if (url.pathname !== path) return;

      this.authorize(request, url)
        .then(({ gameId, conexao }) =>
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.conexoes.set(ws, conexao);
            this.hub.join(gameId, ws);
            (ws as typeof ws & { alive: boolean }).alive = true;
            ws.on('pong', () => ((ws as typeof ws & { alive: boolean }).alive = true));
            ws.on('error', () => ws.terminate());
            ws.on('message', () => ws.close(1008, 'somente leitura'));
            ws.once('close', () => this.conexoes.delete(ws));
          }),
        )
        .catch((status: number) => {
          const frase = status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : 'Forbidden';
          socket.write(`HTTP/1.1 ${typeof status === 'number' ? status : 500} ${frase}\r\nConnection: close\r\n\r\n`);
          socket.destroy();
        });
    });

    this.pinger = setInterval(() => void this.tick(), PING_MS);
    this.pinger.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.pinger);
    this.wss.close();
  }

  /** Derruba as conexões mortas e as de sessão encerrada (logout, troca de senha, conta suspensa). */
  private async tick(): Promise<void> {
    for (const ws of this.wss.clients) {
      const viva = (ws as typeof ws & { alive?: boolean }).alive;
      if (viva === false) ws.terminate();
      else {
        (ws as typeof ws & { alive?: boolean }).alive = false;
        ws.ping();
      }
    }
    if (!this.conexoes.size) return;

    const ids = [...new Set([...this.conexoes.values()].map((c) => c.userId))];
    const jtis = [...this.conexoes.values()].flatMap((c) => (c.jti ? [c.jti] : []));
    const [contas, revogados] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, sessionsValidAfter: true } }),
      this.prisma.revokedToken.findMany({ where: { jti: { in: jtis } }, select: { jti: true } }),
    ]).catch(() => [null, null] as const);
    if (!contas || !revogados) return;

    const porId = new Map(contas.map((c) => [c.id, c]));
    const revogado = new Set(revogados.map((r) => r.jti));
    for (const [ws, conexao] of this.conexoes) {
      const conta = porId.get(conexao.userId);
      const invalidaEm = conta?.sessionsValidAfter ? Math.floor(conta.sessionsValidAfter.getTime() / 1000) : 0;
      if (!conta || conta.status !== 'ACTIVE' || conexao.iat < invalidaEm || (conexao.jti && revogado.has(conexao.jti))) {
        ws.close(4401, 'sessão encerrada');
      }
    }
  }

  /** Devolve o id do jogo se a conta existe, está ativa e pode entrar no chat; senão rejeita com o status. */
  private async authorize(request: IncomingMessage, url: URL): Promise<{ gameId: string; conexao: Conexao }> {
    const origin = request.headers.origin;
    // Navegador manda Origin; cliente sem Origin (Electron em file:// manda "null") não é navegador de terceiro.
    if (origin && !this.config.getOrThrow<string[]>('app.corsOrigins').includes(origin)) {
      this.security.event('ws_origin_refused', { origin });
      throw 403;
    }

    const protocolos = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const token = protocolos.find((p) => p !== WS_PROTOCOL);
    const gameId = url.searchParams.get('gameId');
    if (!protocolos.includes(WS_PROTOCOL) || !token || !gameId) throw 401;

    let payload: JwtPayload;
    try {
      payload = await this.tokens.verify<JwtPayload>('access', token);
    } catch {
      throw 401;
    }
    if (payload.jti && (await this.prisma.revokedToken.findUnique({ where: { jti: payload.jti } }))) throw 401;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, studioId: true, studioPermission: true, sessionsValidAfter: true },
    });
    if (!user || user.status !== 'ACTIVE') throw 401;
    const invalidadasEm = user.sessionsValidAfter ? Math.floor(user.sessionsValidAfter.getTime() / 1000) : 0;
    if ((payload.iat ?? 0) < invalidadasEm) throw 401;

    const abertas = [...this.conexoes.values()].filter((c) => c.userId === user.id).length;
    if (abertas >= MAX_CONEXOES_POR_CONTA) throw 429;

    const viewer: RequestUser = {
      id: user.id,
      role: user.role,
      studioId: user.studioId,
      studioPermission: user.studioPermission,
    };
    try {
      await this.community.assertAccess(viewer, gameId);
    } catch (error) {
      this.logger.debug(`Socket recusado (${viewer.id}, ${gameId}): ${(error as Error).message}`);
      throw 403;
    }
    return { gameId, conexao: { userId: user.id, jti: payload.jti, iat: payload.iat ?? 0 } };
  }
}
