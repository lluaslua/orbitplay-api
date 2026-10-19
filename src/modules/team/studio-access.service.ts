import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { studioIdOf } from '../../common/access/studio-scope';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { AccessGroup, AccessOverview, AccessPermissions, AccessUser, UserStatus } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, UNUSABLE_PASSWORD_HASH } from '../users/password';
import { normalizeEmail } from '../users/users.service';
import type {
  AccessGroupDto,
  InviteAccessUserDto,
  SetAccessPasswordDto,
  UpdateAccessGroupDto,
  UpdateAccessUserDto,
} from './dto/studio-access.dto';
import { TeamService } from './team.service';

/** Os dois poderes de equipe que a tabela mostra como colunas. */
type TeamPower = 'MANAGE_USERS' | 'DELETE_USERS';

const usuarioInclude = {
  groups: { select: { group: { select: { name: true } } } },
} satisfies Prisma.UserInclude;

type UsuarioRow = Prisma.UserGetPayload<{ include: typeof usuarioInclude }>;

const grupoInclude = {
  members: { select: { user: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { user: { name: 'asc' } } },
} satisfies Prisma.StudioGroupInclude;

type GrupoRow = Prisma.StudioGroupGetPayload<{ include: typeof grupoInclude }>;

/**
 * "Gerenciamento de acessos" (Figma `1273:3956` e `1276:5509`) — as mesmas
 * rotas e respostas do mock do app (`/studio/access/*`), em cima da equipe de
 * verdade (`TeamService`).
 *
 * Quem tem MANAGE no estúdio é o "ADM" da tabela: pode tudo e não é suspenso
 * nem excluído pela tela. Os demais fazem o que as colunas "Criar/Editar
 * usuário" e "Excluir usuário" liberam (`User.teamPermissions`). Mexer nessas
 * colunas é só do ADM.
 */
@Injectable()
export class StudioAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly team: TeamService,
    private readonly audit: AuditService,
  ) {}

  async overview(user: RequestUser): Promise<AccessOverview> {
    const studioId = studioIdOf(user);
    const [usuarios, grupos] = await Promise.all([
      this.prisma.user.findMany({
        where: { studioId, role: 'STUDIO', removedFromStudioAt: null },
        include: usuarioInclude,
        orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.studioGroup.findMany({ where: { studioId }, include: grupoInclude, orderBy: { name: 'asc' } }),
    ]);

    const lista = usuarios.map(toAccessUser);
    return {
      summary: {
        activeUsers: lista.filter((u) => u.status === 'ACTIVE').length,
        groups: grupos.length,
        pendingInvites: lista.filter((u) => u.status === 'PENDING').length,
        admins: lista.filter((u) => u.admin).length,
      },
      users: lista,
      groups: grupos.map(toAccessGroup),
    };
  }

  /** Convite por e-mail: a conta nasce PENDING com permissão EDIT e recebe o link para criar a senha. */
  async invite(user: RequestUser, dto: InviteAccessUserDto): Promise<AccessUser> {
    await this.assertPower(user, 'MANAGE_USERS');
    const email = normalizeEmail(dto.email);
    const existente = await this.prisma.user.findUnique({ where: { email }, select: { studioId: true, removedFromStudioAt: true } });
    if (existente) {
      const daEquipe = existente.studioId === studioIdOf(user) && !existente.removedFromStudioAt;
      throw new ConflictException({
        message: daEquipe ? 'Este e-mail já tem acesso ao estúdio.' : 'Já existe uma conta com este e-mail.',
        code: ErrorCode.EMAIL_TAKEN,
        fields: { email: daEquipe ? 'Este e-mail já tem acesso ao estúdio.' : 'Já existe uma conta com este e-mail.' },
      });
    }

    const membro = await this.team.inviteMember(user, { name: email.split('@')[0], email, permission: 'EDIT' });
    return this.userOf(studioIdOf(user), membro.id);
  }

  async updateUser(user: RequestUser, id: string, dto: UpdateAccessUserDto): Promise<AccessUser> {
    const studioId = studioIdOf(user);
    const alvo = await this.findUser(studioId, id);
    const admin = alvo.studioPermission === 'MANAGE';
    const data: Prisma.UserUpdateInput = {};

    if (dto.permissions) {
      if (user.studioPermission !== 'MANAGE') throw semPoder('Só o administrador do estúdio muda as permissões.');
      if (admin) throw adminProtegido('O administrador do estúdio tem todas as permissões.');
      const atuais = permissoesDe(alvo);
      const novas = { ...atuais, ...dto.permissions };
      data.teamPermissions = [
        ...(novas.manageUsers ? (['MANAGE_USERS'] as const) : []),
        ...(novas.deleteUsers ? (['DELETE_USERS'] as const) : []),
      ];
    }

    if (dto.status && dto.status !== statusNaTela(alvo)) {
      await this.assertPower(user, 'MANAGE_USERS');
      if (alvo.id === user.id) throw semPoder('Você não pode suspender a própria conta.');
      if (admin) throw adminProtegido('O administrador do estúdio não pode ser suspenso.');
      if (dto.status === 'INACTIVE') {
        data.status = 'INACTIVE';
        data.sessionsValidAfter = new Date();
      } else {
        // Quem foi convidado e ainda não criou a senha volta a ser convite.
        data.status = alvo.passwordHash === UNUSABLE_PASSWORD_HASH ? 'PENDING' : 'ACTIVE';
      }
    }

    if (Object.keys(data).length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data });
        await this.audit.record(
          { actorId: user.id, action: 'access.update', targetType: 'user', targetId: id, data: { status: dto.status, permissions: dto.permissions } },
          tx,
        );
      });
    }
    return this.userOf(studioId, id);
  }

  /** "Redefinir senha": vale na hora, derruba as sessões abertas e ativa o convite pendente. */
  async setPassword(user: RequestUser, id: string, dto: SetAccessPasswordDto): Promise<{ message: string }> {
    await this.assertPower(user, 'MANAGE_USERS');
    const studioId = studioIdOf(user);
    const alvo = await this.findUser(studioId, id);
    if (alvo.studioPermission === 'MANAGE' && alvo.id !== user.id && user.studioPermission !== 'MANAGE') {
      throw adminProtegido('Só o administrador troca a senha de outro administrador.');
    }

    const agora = new Date();
    const passwordHash = await hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, sessionsValidAfter: agora, ...(alvo.status === 'PENDING' ? { status: 'ACTIVE' } : {}) },
      });
      await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: agora } });
      await this.audit.record({ actorId: user.id, action: 'access.password', targetType: 'user', targetId: id }, tx);
    });
    return { message: 'Senha atualizada.' };
  }

  /** "Excluir": sai da equipe, dos grupos e dos jogos (`TeamService.removeMember`). */
  async removeUser(user: RequestUser, id: string): Promise<{ id: string }> {
    await this.assertPower(user, 'DELETE_USERS');
    const alvo = await this.findUser(studioIdOf(user), id);
    if (alvo.studioPermission === 'MANAGE') throw adminProtegido('O administrador do estúdio não pode ser excluído.');
    if (alvo.id === user.id) throw semPoder('Você não pode excluir a própria conta.');

    // O convite pendente ou a conta suspensa saem do mesmo jeito.
    await this.prisma.$transaction(async (tx) => {
      await tx.studioGroupMember.deleteMany({ where: { userId: id } });
      await tx.gameAccess.deleteMany({ where: { userId: id } });
      await tx.user.update({ where: { id }, data: { status: 'INACTIVE', sessionsValidAfter: new Date(), removedFromStudioAt: new Date() } });
      await this.audit.record({ actorId: user.id, action: 'team.remove', targetType: 'user', targetId: id }, tx);
    });
    return { id };
  }

  // --- Grupos ----------------------------------------------------------------

  async createGroup(user: RequestUser, dto: AccessGroupDto): Promise<AccessGroup> {
    await this.assertPower(user, 'MANAGE_USERS');
    const grupo = await this.team.createGroup(user, { name: dto.name, memberIds: dto.memberIds ?? [] });
    return this.groupOf(grupo.id);
  }

  async updateGroup(user: RequestUser, id: string, dto: UpdateAccessGroupDto): Promise<AccessGroup> {
    await this.assertPower(user, 'MANAGE_USERS');
    if (dto.name !== undefined) await this.team.updateGroup(user, id, { name: dto.name });
    if (dto.memberIds) await this.team.setGroupMembers(user, id, dto.memberIds);
    if (dto.name === undefined && !dto.memberIds) {
      const existe = await this.prisma.studioGroup.findFirst({ where: { id, studioId: studioIdOf(user) }, select: { id: true } });
      if (!existe) throw new NotFoundException({ message: 'Grupo não encontrado.' });
    }
    return this.groupOf(id);
  }

  async removeGroup(user: RequestUser, id: string): Promise<{ id: string }> {
    await this.assertPower(user, 'MANAGE_USERS');
    await this.team.removeGroup(user, id);
    return { id };
  }

  // --- Conferências ----------------------------------------------------------

  /** MANAGE pode tudo; os outros dependem das colunas da tabela. */
  private async assertPower(user: RequestUser, poder: TeamPower): Promise<void> {
    if (user.studioPermission === 'MANAGE') return;
    const conta = await this.prisma.user.findUnique({ where: { id: user.id }, select: { teamPermissions: true } });
    if (!conta?.teamPermissions.includes(poder)) {
      throw semPoder(poder === 'DELETE_USERS' ? 'Você não tem permissão para excluir usuários.' : 'Você não tem permissão para criar ou editar usuários.');
    }
  }

  private async findUser(studioId: string, id: string): Promise<UsuarioRow> {
    const usuario = await this.prisma.user.findFirst({
      where: { id, studioId, role: 'STUDIO', removedFromStudioAt: null },
      include: usuarioInclude,
    });
    if (!usuario) throw new NotFoundException({ message: 'Usuário não encontrado.' });
    return usuario;
  }

  private async userOf(studioId: string, id: string): Promise<AccessUser> {
    return toAccessUser(await this.findUser(studioId, id));
  }

  private async groupOf(id: string): Promise<AccessGroup> {
    return toAccessGroup(await this.prisma.studioGroup.findUniqueOrThrow({ where: { id }, include: grupoInclude }));
  }
}

function permissoesDe(usuario: UsuarioRow): AccessPermissions {
  if (usuario.studioPermission === 'MANAGE') return { manageUsers: true, deleteUsers: true };
  return {
    manageUsers: usuario.teamPermissions.includes('MANAGE_USERS'),
    deleteUsers: usuario.teamPermissions.includes('DELETE_USERS'),
  };
}

/** A tela só conhece ACTIVE e INACTIVE para o botão; PENDING conta como ativo. */
function statusNaTela(usuario: UsuarioRow): 'ACTIVE' | 'INACTIVE' {
  return usuario.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

function toAccessUser(usuario: UsuarioRow): AccessUser {
  return {
    id: usuario.id,
    name: usuario.name,
    email: usuario.email,
    ...(usuario.avatarUrl ? { avatarUrl: usuario.avatarUrl } : {}),
    status: usuario.status as UserStatus,
    admin: usuario.studioPermission === 'MANAGE',
    groups: usuario.groups.map((g) => g.group.name).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    lastAccessAt: usuario.lastLoginAt?.toISOString() ?? null,
    permissions: permissoesDe(usuario),
  };
}

/** Grupo sem participante fica INACTIVE — é o que a tabela mostra. */
function toAccessGroup(grupo: GrupoRow): AccessGroup {
  const members = grupo.members.map(({ user }) => ({ id: user.id, name: user.name, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) }));
  return { id: grupo.id, name: grupo.name, status: members.length ? 'ACTIVE' : 'INACTIVE', members };
}

function semPoder(message: string) {
  return new ForbiddenException({ message, code: ErrorCode.TEAM_PERMISSION });
}

function adminProtegido(message: string) {
  return new ConflictException({ message, code: ErrorCode.ADMIN });
}
