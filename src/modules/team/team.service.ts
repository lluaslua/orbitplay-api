import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameAccessService } from '../../common/access/game-access.service';
import { studioIdOf } from '../../common/access/studio-scope';
import { GAME_PERMISSIONS } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type {
  GameAccessEntry,
  GamePermission,
  StudioGroup,
  StudioMember,
  StudioPermission,
  StudioTeam,
  UserStatus,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UNUSABLE_PASSWORD_HASH } from '../users/password';
import { normalizeEmail } from '../users/users.service';
import type {
  GameAccessDto,
  GroupDto,
  InviteMemberDto,
  ListMembersQueryDto,
  UpdateGroupDto,
  UpdateMemberDto,
} from './dto/team.dto';

const membroInclude = {
  groups: { select: { group: { select: { id: true, name: true } } } },
} satisfies Prisma.UserInclude;

type MembroRow = Prisma.UserGetPayload<{ include: typeof membroInclude }>;

const grupoInclude = {
  members: { select: { user: { select: { id: true, name: true, avatarUrl: true } } } },
} satisfies Prisma.StudioGroupInclude;

type GrupoRow = Prisma.StudioGroupGetPayload<{ include: typeof grupoInclude }>;

/**
 * Equipe do estúdio: membros, grupos e as permissões de cada um por jogo
 * (Figma `1187:9418` e `1188:10038`). Tudo filtrado pela organização de quem pede.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GameAccessService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Membros ---------------------------------------------------------------

  async listMembers(user: RequestUser, query: ListMembersQueryDto): Promise<StudioMember[]> {
    const termo = query.search?.trim().replace(/^@/, '');
    const membros = await this.prisma.user.findMany({
      where: {
        studioId: studioIdOf(user),
        role: 'STUDIO',
        status: { not: 'INACTIVE' },
        ...(termo
          ? { OR: [{ name: { contains: termo, mode: 'insensitive' } }, { email: { contains: termo, mode: 'insensitive' } }] }
          : {}),
      },
      include: membroInclude,
      orderBy: { name: 'asc' },
    });
    return membros.map(toMember);
  }

  /** A conta nasce PENDING e recebe o link para criar a senha, como o convite da Central. */
  async inviteMember(user: RequestUser, dto: InviteMemberDto): Promise<StudioMember> {
    const studioId = studioIdOf(user);
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({
        message: 'Já existe uma conta com este e-mail.',
        code: ErrorCode.EMAIL_TAKEN,
        fields: { email: 'Já existe uma conta com este e-mail.' },
      });
    }
    const grupos = await this.groupsOf(studioId, dto.groupIds ?? []);

    const criado = await this.prisma.$transaction(async (tx) => {
      const membro = await tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role: 'STUDIO',
          status: 'PENDING',
          studioId,
          studioPermission: dto.permission ?? 'EDIT',
          groups: { create: grupos.map((groupId) => ({ groupId })) },
        },
        include: membroInclude,
      });
      await this.audit.record(
        { actorId: user.id, action: 'team.invite', targetType: 'user', targetId: membro.id, data: { email, permission: membro.studioPermission } },
        tx,
      );
      return membro;
    });

    const estudio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
    await this.auth.sendPasswordLink(criado.id, criado.email, `Convite para a equipe ${estudio.name} na OrbitPlay`);
    return toMember(criado);
  }

  async updateMember(user: RequestUser, id: string, dto: UpdateMemberDto): Promise<StudioMember> {
    const studioId = studioIdOf(user);
    const alvo = await this.memberOf(studioId, id);
    if (dto.permission && dto.permission !== 'MANAGE' && alvo.studioPermission === 'MANAGE') {
      await this.assertAnotherManager(studioId, id);
    }
    const grupos = dto.groupIds ? await this.groupsOf(studioId, dto.groupIds) : null;

    const atualizado = await this.prisma.$transaction(async (tx) => {
      if (grupos) {
        await tx.studioGroupMember.deleteMany({ where: { userId: id, group: { studioId } } });
        await tx.studioGroupMember.createMany({ data: grupos.map((groupId) => ({ groupId, userId: id })) });
      }
      const membro = await tx.user.update({
        where: { id },
        data: {
          studioPermission: dto.permission,
          // Permissão menor vale na hora: tokens antigos caem.
          ...(dto.permission && dto.permission !== alvo.studioPermission ? { sessionsValidAfter: new Date() } : {}),
        },
        include: membroInclude,
      });
      await this.audit.record(
        { actorId: user.id, action: 'team.update', targetType: 'user', targetId: id, data: { permission: dto.permission, groupIds: dto.groupIds } },
        tx,
      );
      return membro;
    });
    return toMember(atualizado);
  }

  /** Tira da equipe: a conta é desativada e sai dos grupos e dos jogos. */
  async removeMember(user: RequestUser, id: string): Promise<{ removed: true }> {
    const studioId = studioIdOf(user);
    const alvo = await this.memberOf(studioId, id);
    if (alvo.studioPermission === 'MANAGE') await this.assertAnotherManager(studioId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.studioGroupMember.deleteMany({ where: { userId: id } });
      await tx.gameAccess.deleteMany({ where: { userId: id } });
      // `removedFromStudioAt` separa quem saiu da equipe de quem só está suspenso.
      await tx.user.update({ where: { id }, data: { status: 'INACTIVE', sessionsValidAfter: new Date(), removedFromStudioAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: 'team.remove', targetType: 'user', targetId: id }, tx);
    });
    return { removed: true };
  }

  /**
   * `GET /studio/team` — o que o modal "Adicionar membro ou grupo" do Novo
   * jogo oferece (Figma `1188:10038`).
   */
  async teamOf(user: RequestUser): Promise<StudioTeam> {
    const [grupos, membros] = await Promise.all([this.listGroups(user), this.listMembers(user, {})]);
    return {
      groups: grupos.map(({ id, name, memberCount }) => ({ id, name, memberCount })),
      members: membros.map(({ id, name, avatarUrl }) => ({ id, name, ...(avatarUrl ? { avatarUrl } : {}) })),
    };
  }

  // --- Grupos ----------------------------------------------------------------

  async listGroups(user: RequestUser): Promise<StudioGroup[]> {
    const grupos = await this.prisma.studioGroup.findMany({
      where: { studioId: studioIdOf(user) },
      include: grupoInclude,
      orderBy: { name: 'asc' },
    });
    return grupos.map(toGroup);
  }

  async createGroup(user: RequestUser, dto: GroupDto): Promise<StudioGroup> {
    const studioId = studioIdOf(user);
    const membros = await this.membersOf(studioId, dto.memberIds ?? []);
    try {
      const grupo = await this.prisma.studioGroup.create({
        data: { studioId, name: dto.name.trim(), members: { create: membros.map((userId) => ({ userId })) } },
        include: grupoInclude,
      });
      return toGroup(grupo);
    } catch (erro) {
      throw nomeRepetido(erro);
    }
  }

  async updateGroup(user: RequestUser, id: string, dto: UpdateGroupDto): Promise<StudioGroup> {
    await this.groupOf(studioIdOf(user), id);
    try {
      const grupo = await this.prisma.studioGroup.update({ where: { id }, data: { name: dto.name?.trim() }, include: grupoInclude });
      return toGroup(grupo);
    } catch (erro) {
      throw nomeRepetido(erro);
    }
  }

  async setGroupMembers(user: RequestUser, id: string, memberIds: string[]): Promise<StudioGroup> {
    const studioId = studioIdOf(user);
    await this.groupOf(studioId, id);
    const membros = await this.membersOf(studioId, memberIds);
    const grupo = await this.prisma.$transaction(async (tx) => {
      await tx.studioGroupMember.deleteMany({ where: { groupId: id } });
      await tx.studioGroupMember.createMany({ data: membros.map((userId) => ({ groupId: id, userId })) });
      return tx.studioGroup.findUniqueOrThrow({ where: { id }, include: grupoInclude });
    });
    return toGroup(grupo);
  }

  async removeGroup(user: RequestUser, id: string): Promise<{ deleted: true }> {
    await this.groupOf(studioIdOf(user), id);
    await this.prisma.studioGroup.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Permissões por jogo ---------------------------------------------------

  async getGameAccess(user: RequestUser, gameId: string): Promise<GameAccessEntry[]> {
    const game = await this.prisma.game.findFirst({ where: { id: gameId, ...this.access.visibleGames(user) }, select: { id: true } });
    if (!game) throw new NotFoundException({ message: 'Jogo não encontrado.' });
    return this.accessEntries(gameId);
  }

  /**
   * Troca a tabela inteira de uma vez — é o "Salvar" do passo Permissões.
   * Quem não tem MANAGE no estúdio não pode se tirar do próprio controle.
   */
  async setGameAccess(user: RequestUser, gameId: string, dto: GameAccessDto): Promise<GameAccessEntry[]> {
    const studioId = studioIdOf(user);
    await this.access.assert(user, gameId, 'MANAGE_ACCESS');

    const vistos = new Set<string>();
    dto.entries.forEach((entrada, i) => {
      if (!!entrada.userId === !!entrada.groupId) {
        throw invalido(`entries.${i}`, 'Informe um membro ou um grupo, não os dois.');
      }
      const chave = entrada.userId ? `u:${entrada.userId}` : `g:${entrada.groupId}`;
      if (vistos.has(chave)) throw invalido(`entries.${i}`, 'Membro ou grupo repetido.');
      vistos.add(chave);
    });

    const userIds = dto.entries.flatMap((e) => (e.userId ? [e.userId] : []));
    const groupIds = dto.entries.flatMap((e) => (e.groupId ? [e.groupId] : []));
    await this.membersOf(studioId, userIds);
    await this.groupsOf(studioId, groupIds);

    const anteriores = await this.prisma.gameAccess.findMany({ where: { gameId }, select: { userId: true } });
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { name: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.gameAccess.deleteMany({ where: { gameId } });
      await tx.gameAccess.createMany({
        data: dto.entries.map((e) => ({
          gameId,
          userId: e.userId ?? null,
          groupId: e.groupId ?? null,
          permissions: GAME_PERMISSIONS.filter((p) => e.permissions.includes(p)),
        })),
      });

      if (user.studioPermission !== 'MANAGE') {
        const minhas = await this.access.permissionsOf(user, gameId, tx);
        if (!minhas.includes('MANAGE_ACCESS')) {
          throw new UnprocessableEntityException({
            message: 'Você não pode tirar de si mesmo a permissão de editar permissões deste jogo.',
            code: ErrorCode.GAME_PERMISSION,
          });
        }
      }

      const novos = userIds.filter((id) => id !== user.id && !anteriores.some((a) => a.userId === id));
      await this.notifications.notify(
        novos,
        {
          type: 'GAME_ACCESS_GRANTED',
          title: 'Você entrou em um jogo',
          body: `Você agora faz parte da equipe de "${game.name}".`,
          link: `/studio/games/${gameId}`,
          data: { gameId },
        },
        tx,
      );
      await this.audit.record(
        { actorId: user.id, action: 'game.access', targetType: 'game', targetId: gameId, data: { entries: dto.entries.length } },
        tx,
      );
    });

    return this.accessEntries(gameId);
  }

  private async accessEntries(gameId: string): Promise<GameAccessEntry[]> {
    const entradas = await this.prisma.gameAccess.findMany({
      where: { gameId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        group: { select: { id: true, name: true, _count: { select: { members: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return entradas.map((e) =>
      e.group
        ? {
            id: e.id,
            kind: 'GROUP' as const,
            targetId: e.group.id,
            name: e.group.name,
            avatarUrl: null,
            memberCount: e.group._count.members,
            permissions: e.permissions as GamePermission[],
          }
        : {
            id: e.id,
            kind: 'MEMBER' as const,
            targetId: e.user!.id,
            name: e.user!.name,
            avatarUrl: e.user!.avatarUrl,
            permissions: e.permissions as GamePermission[],
          },
    );
  }

  // --- Conferências ----------------------------------------------------------

  private async memberOf(studioId: string, id: string) {
    const membro = await this.prisma.user.findFirst({ where: { id, studioId, role: 'STUDIO', status: { not: 'INACTIVE' } } });
    if (!membro) throw new NotFoundException({ message: 'Membro não encontrado.' });
    return membro;
  }

  private async membersOf(studioId: string, ids: string[]): Promise<string[]> {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return [];
    const achados = await this.prisma.user.count({ where: { id: { in: unicos }, studioId, role: 'STUDIO', status: { not: 'INACTIVE' } } });
    if (achados !== unicos.length) throw invalido('memberIds', 'Há membros que não são deste estúdio.');
    return unicos;
  }

  private async groupsOf(studioId: string, ids: string[]): Promise<string[]> {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return [];
    const achados = await this.prisma.studioGroup.count({ where: { id: { in: unicos }, studioId } });
    if (achados !== unicos.length) throw invalido('groupIds', 'Há grupos que não são deste estúdio.');
    return unicos;
  }

  private async groupOf(studioId: string, id: string) {
    const grupo = await this.prisma.studioGroup.findFirst({ where: { id, studioId } });
    if (!grupo) throw new NotFoundException({ message: 'Grupo não encontrado.' });
    return grupo;
  }

  /** O estúdio nunca fica sem alguém que possa pagar e gerir a equipe. */
  private async assertAnotherManager(studioId: string, exceto: string) {
    const outros = await this.prisma.user.count({
      where: { studioId, role: 'STUDIO', status: 'ACTIVE', studioPermission: 'MANAGE', id: { not: exceto } },
    });
    if (!outros) {
      throw new ConflictException({
        message: 'O estúdio precisa de pelo menos um membro com permissão de gestão.',
        code: ErrorCode.LAST_MANAGER,
      });
    }
  }
}

function toMember(membro: MembroRow): StudioMember {
  return {
    id: membro.id,
    name: membro.name,
    email: membro.email,
    avatarUrl: membro.avatarUrl,
    status: membro.status as UserStatus,
    permission: (membro.studioPermission ?? 'VIEW') as StudioPermission,
    groups: membro.groups.map((g) => g.group),
  };
}

function toGroup(grupo: GrupoRow): StudioGroup {
  return {
    id: grupo.id,
    name: grupo.name,
    memberCount: grupo.members.length,
    members: grupo.members.map((m) => m.user),
  };
}

function invalido(campo: string, mensagem: string) {
  return new BadRequestException({ message: 'Confira os campos destacados.', code: ErrorCode.VALIDATION_ERROR, fields: { [campo]: mensagem } });
}

function nomeRepetido(erro: unknown) {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    return new ConflictException({ message: 'Já existe um grupo com este nome.', fields: { name: 'Já existe um grupo com este nome.' } });
  }
  return erro;
}
