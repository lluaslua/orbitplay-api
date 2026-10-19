import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { GamePermission, StudioPermission } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GAME_PERMISSIONS } from '../constants/domain.constants';
import { ErrorCode } from '../constants/error-codes';
import type { RequestUser } from '../interfaces/jwt-payload.interface';
import { studioIdOf } from './studio-scope';

type Cliente = PrismaService | Prisma.TransactionClient;

/**
 * Jogo sem nenhuma linha em "Responsáveis e permissões" segue a permissão do
 * estúdio, como antes de a tela existir: quem edita no estúdio edita o jogo,
 * quem só vê, vê os relatórios. Excluir e mexer em permissões fica com MANAGE.
 */
const PELO_ESTUDIO: Record<StudioPermission, GamePermission[]> = {
  MANAGE: GAME_PERMISSIONS,
  EDIT: ['EDIT_INFO', 'MANAGE_TESTS', 'VIEW_REPORTS'],
  VIEW: ['VIEW_REPORTS'],
};

/**
 * Permissões por jogo (Figma `1187:9418`). A permissão do estúdio continua
 * valendo por cima — o StudioPermissionGuard barra quem só tem VIEW nas rotas
 * de escrita —, e esta camada restringe dentro do estúdio, jogo a jogo.
 */
@Injectable()
export class GameAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** O que a conta pode fazer no jogo. Jogo de outro estúdio: nada. */
  async permissionsOf(user: RequestUser, gameId: string, client: Cliente = this.prisma): Promise<GamePermission[]> {
    if (user.role !== 'STUDIO' || !user.studioId || !user.studioPermission) return [];
    if (user.studioPermission === 'MANAGE') return [...GAME_PERMISSIONS];

    const entradas = await client.gameAccess.findMany({
      where: { gameId },
      select: { userId: true, permissions: true, group: { select: { members: { where: { userId: user.id }, select: { userId: true } } } } },
    });
    if (!entradas.length) return [...PELO_ESTUDIO[user.studioPermission]];

    const minhas = entradas.filter((e) => e.userId === user.id || (e.group?.members.length ?? 0) > 0);
    const todas = new Set(minhas.flatMap((e) => e.permissions as GamePermission[]));
    return GAME_PERMISSIONS.filter((p) => todas.has(p));
  }

  /**
   * Jogo do estúdio de quem pediu e com a permissão pedida. Jogo de outro
   * estúdio é 404 — nunca revela que existe; sem permissão, 403.
   */
  async assert(user: RequestUser, gameId: string, permission: GamePermission, client: Cliente = this.prisma) {
    const game = await client.game.findFirst({ where: { id: gameId, studioId: studioIdOf(user) } });
    if (!game) throw new NotFoundException({ message: 'Jogo não encontrado.' });
    const permissoes = await this.permissionsOf(user, gameId, client);
    if (!permissoes.includes(permission)) throw semPermissao(permission);
    return game;
  }

  /** O mesmo, partindo do teste. Devolve o id do jogo. */
  async assertForTest(user: RequestUser, testId: string, permission: GamePermission): Promise<string> {
    const teste = await this.prisma.playtest.findFirst({
      where: { id: testId, game: { studioId: studioIdOf(user) } },
      select: { gameId: true },
    });
    if (!teste) throw new NotFoundException({ message: 'Teste não encontrado.' });
    await this.assert(user, teste.gameId, permission);
    return teste.gameId;
  }

  /** O mesmo, partindo da sessão. */
  async assertForSession(user: RequestUser, sessionId: string, permission: GamePermission): Promise<string> {
    const sessao = await this.prisma.session.findFirst({
      where: { id: sessionId, participation: { playtest: { game: { studioId: studioIdOf(user) } } } },
      select: { participation: { select: { playtest: { select: { gameId: true } } } } },
    });
    if (!sessao) throw new NotFoundException({ message: 'Sessão não encontrada.' });
    const gameId = sessao.participation.playtest.gameId;
    await this.assert(user, gameId, permission);
    return gameId;
  }

  /**
   * Filtro dos jogos que a conta enxerga no estúdio: todos para MANAGE; para
   * os outros, os sem regra e os em que a conta (ou um grupo dela) aparece.
   */
  visibleGames(user: RequestUser): Prisma.GameWhereInput {
    const studioId = studioIdOf(user);
    if (user.studioPermission === 'MANAGE') return { studioId };
    return {
      studioId,
      OR: [
        { access: { none: {} } },
        {
          access: {
            some: {
              permissions: { isEmpty: false },
              OR: [{ userId: user.id }, { group: { members: { some: { userId: user.id } } } }],
            },
          },
        },
      ],
    };
  }

  /** Contas ativas do estúdio com a permissão no jogo — para quem a notificação vai. */
  async usersWith(gameId: string, permission: GamePermission, client: Cliente = this.prisma): Promise<string[]> {
    const game = await client.game.findUnique({ where: { id: gameId }, select: { studioId: true } });
    if (!game) return [];
    const membros = await client.user.findMany({
      where: { studioId: game.studioId, role: 'STUDIO', status: 'ACTIVE' },
      select: { id: true, role: true, studioId: true, studioPermission: true },
    });
    const com: string[] = [];
    for (const membro of membros) {
      const permissoes = await this.permissionsOf(membro, gameId, client);
      if (permissoes.includes(permission)) com.push(membro.id);
    }
    return com;
  }
}

function semPermissao(permission: GamePermission) {
  const acao: Record<GamePermission, string> = {
    MANAGE_ACCESS: 'mexer nas permissões deste jogo',
    EDIT_INFO: 'editar as informações deste jogo',
    MANAGE_TESTS: 'criar ou editar testes deste jogo',
    VIEW_REPORTS: 'ver os relatórios deste jogo',
  };
  return new ForbiddenException({ message: `Sua conta não tem permissão para ${acao[permission]}.`, code: ErrorCode.GAME_PERMISSION });
}

@Global()
@Module({
  providers: [GameAccessService],
  exports: [GameAccessService],
})
export class GameAccessModule {}
