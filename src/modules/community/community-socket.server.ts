import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { JwtPayload, RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunityHub } from './community.hub';
import { CommunityService } from './community.service';

/** Pings a cada 30 s derrubam conexões mortas (aba fechada sem despedida). */
const PING_MS = 30_000;

/**
 * `ws://host/api/community/ws?gameId=…&token=…` — o navegador não manda
 * cabeçalho no WebSocket, então o token JWT vai na query. As mesmas regras do
 * `JwtAuthGuard` e do `CommunityAccessGuard` valem aqui; quem não passa recebe
 * o mesmo status HTTP no upgrade.
 */
@Injectable()
export class CommunitySocketServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommunitySocketServer.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private pinger?: NodeJS.Timeout;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly community: CommunityService,
    private readonly hub: CommunityHub,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    const path = `/${this.config.getOrThrow<string>('app.prefix')}/community/ws`;

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '', 'http://localhost');
      if (url.pathname !== path) return;

      this.authorize(url)
        .then((gameId) =>
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.hub.join(gameId, ws);
            (ws as typeof ws & { alive: boolean }).alive = true;
            ws.on('pong', () => ((ws as typeof ws & { alive: boolean }).alive = true));
            ws.on('error', () => ws.terminate());
          }),
        )
        .catch((status: number) => {
          socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
          socket.destroy();
        });
    });

    this.pinger = setInterval(() => {
      for (const ws of this.wss.clients) {
        const viva = (ws as typeof ws & { alive?: boolean }).alive;
        if (viva === false) ws.terminate();
        else {
          (ws as typeof ws & { alive?: boolean }).alive = false;
          ws.ping();
        }
      }
    }, PING_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.pinger);
    this.wss.close();
  }

  /** Devolve o id do jogo se a conta existe, está ativa e pode entrar no chat; senão rejeita com o status. */
  private async authorize(url: URL): Promise<string> {
    const token = url.searchParams.get('token');
    const gameId = url.searchParams.get('gameId');
    if (!token || !gameId) throw 401;

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw 401;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, studioId: true, studioPermission: true, sessionsValidAfter: true },
    });
    if (!user || user.status !== 'ACTIVE') throw 401;
    const invalidadasEm = user.sessionsValidAfter ? Math.floor(user.sessionsValidAfter.getTime() / 1000) : 0;
    if ((payload.iat ?? 0) < invalidadasEm) throw 401;

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
    return gameId;
  }
}
