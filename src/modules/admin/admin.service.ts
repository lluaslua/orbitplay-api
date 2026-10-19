import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { pageArgs } from '../../common/pagination/pagination';
import { formatBRL } from '../../common/utils/money';
import type { AdminUserRow, AdminWithdrawalRow, AuditLogEntry, StudioSummary } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UNUSABLE_PASSWORD_HASH } from '../users/password';
import { normalizeEmail } from '../users/users.service';
import { toWithdrawalInfo } from '../wallet/wallet.service';
import type {
  AuditQueryDto,
  BalanceAdjustmentDto,
  CreateStudioDto,
  CreateUserDto,
  ListUsersQueryDto,
  ListWithdrawalsQueryDto,
  ProcessWithdrawalDto,
  UpdateUserDto,
} from './dto/admin.dto';

const comEstudio = { studio: { select: { id: true, name: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof comEstudio }>;

/**
 * Central de gerenciamento de usuários (Handoff, Tela 20). Toda mudança de
 * papel, status ou dado sensível sai com registro de auditoria, na mesma
 * transação (RN-05); a senha nunca passa por aqui (RN-04).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  async listUsers(query: ListUsersQueryDto): Promise<{ items: AdminUserRow[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: comEstudio, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toRow), total };
  }

  /** A conta nasce PENDING e recebe o link para definir a própria senha. */
  async createUser(actor: RequestUser, dto: CreateUserDto): Promise<AdminUserRow> {
    this.assertMayGrant(actor, dto.role);
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);
    if (dto.role === 'STUDIO') await this.studioOf(dto.studioId);

    const user = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash: UNUSABLE_PASSWORD_HASH,
          role: dto.role,
          status: 'PENDING',
          studioId: dto.role === 'STUDIO' ? dto.studioId : null,
          studioPermission: dto.role === 'STUDIO' ? (dto.studioPermission ?? 'EDIT') : null,
          ...(dto.role === 'PLAYER' ? { player: { create: {} } } : {}),
        },
        include: comEstudio,
      });
      await this.audit.record(
        { actorId: actor.id, action: 'user.create', targetType: 'user', targetId: criado.id, data: { email, role: dto.role } },
        tx,
      );
      return criado;
    });

    await this.auth.sendPasswordLink(user.id, user.email, 'Convite para a OrbitPlay');
    return toRow(user);
  }

  async updateUser(actor: RequestUser, id: string, dto: UpdateUserDto): Promise<AdminUserRow> {
    const alvo = await this.userOf(id);
    this.assertMayManage(actor, alvo);

    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    if (email && email !== alvo.email) await this.assertEmailFree(email);
    const mexeNoEstudio = dto.studioId !== undefined || dto.studioPermission !== undefined;
    if (mexeNoEstudio && alvo.role !== 'STUDIO') {
      throw new UnprocessableEntityException({ message: 'Só contas de estúdio pertencem a uma organização.' });
    }
    if (dto.studioId) await this.studioOf(dto.studioId);
    if (alvo.role === 'STUDIO' && dto.studioId === null) {
      throw new UnprocessableEntityException({ message: 'Conta de estúdio precisa de uma organização.' });
    }

    const mudancas = {
      name: dto.name?.trim(),
      email,
      studioId: dto.studioId ?? undefined,
      studioPermission: dto.studioPermission ?? undefined,
    };
    const user = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.user.update({ where: { id }, data: mudancas, include: comEstudio });
      await this.audit.record({ actorId: actor.id, action: 'user.update', targetType: 'user', targetId: id, data: mudancas }, tx);
      return atualizado;
    });
    return toRow(user);
  }

  /** Desativação lógica: a conta perde o acesso na hora e o histórico fica (RN-06). */
  async setStatus(actor: RequestUser, id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<AdminUserRow> {
    const alvo = await this.userOf(id);
    this.assertMayManage(actor, alvo);
    if (status === 'INACTIVE') {
      if (alvo.id === actor.id) throw new UnprocessableEntityException({ message: 'Você não pode desativar a própria conta.' });
      if (alvo.role === 'OWNER') await this.assertNotLastOwner(alvo.id);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.user.update({
        where: { id },
        data: { status, ...(status === 'INACTIVE' ? { sessionsValidAfter: new Date() } : {}) },
        include: comEstudio,
      });
      await this.audit.record(
        { actorId: actor.id, action: 'user.status', targetType: 'user', targetId: id, data: { from: alvo.status, to: status } },
        tx,
      );
      return atualizado;
    });
    return toRow(user);
  }

  /** Promover ou rebaixar. Ação crítica: o app confirma antes; aqui, as travas (RN-02 e RN-03). */
  async setRole(actor: RequestUser, id: string, role: UserRole): Promise<AdminUserRow> {
    const alvo = await this.userOf(id);
    this.assertMayManage(actor, alvo);
    this.assertMayGrant(actor, role);
    if (alvo.role === role) return toRow(alvo);
    if (alvo.role === 'OWNER') await this.assertNotLastOwner(alvo.id);
    if (role === 'STUDIO' && !alvo.studioId) {
      throw new UnprocessableEntityException({ message: 'Associe a conta a um estúdio antes de torná-la de estúdio.' });
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (role === 'PLAYER') {
        await tx.playerProfile.upsert({ where: { userId: id }, create: { userId: id }, update: {} });
      }
      const atualizado = await tx.user.update({
        where: { id },
        // O token antigo carregava o papel antigo.
        data: {
          role,
          sessionsValidAfter: new Date(),
          ...(role === 'STUDIO' ? { studioPermission: alvo.studioPermission ?? 'EDIT' } : {}),
        },
        include: comEstudio,
      });
      await this.audit.record(
        { actorId: actor.id, action: 'user.role', targetType: 'user', targetId: id, data: { from: alvo.role, to: role } },
        tx,
      );
      return atualizado;
    });
    return toRow(user);
  }

  /** A senha nunca é exibida: a conta recebe o link de redefinição (RN-04). */
  async sendPasswordReset(actor: RequestUser, id: string): Promise<{ message: string }> {
    const alvo = await this.userOf(id);
    this.assertMayManage(actor, alvo);
    await this.auth.sendPasswordLink(alvo.id, alvo.email, 'Redefinição de senha');
    await this.audit.record({ actorId: actor.id, action: 'user.password-reset', targetType: 'user', targetId: id });
    return { message: `Enviamos o link de redefinição para ${alvo.email}.` };
  }

  async listAuditLogs(query: AuditQueryDto): Promise<{ items: AuditLogEntry[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        data: r.data as Record<string, unknown> | null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  async listStudios(): Promise<StudioSummary[]> {
    const estudios = await this.prisma.studio.findMany({
      include: { _count: { select: { members: true, games: true } } },
      orderBy: { name: 'asc' },
    });
    return estudios.map(toStudio);
  }

  async createStudio(actor: RequestUser, dto: CreateStudioDto): Promise<StudioSummary> {
    const estudio = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.studio.create({
        data: { name: dto.name.trim(), cnpj: dto.cnpj, website: dto.website },
        include: { _count: { select: { members: true, games: true } } },
      });
      await this.audit.record({ actorId: actor.id, action: 'studio.create', targetType: 'studio', targetId: criado.id }, tx);
      return criado;
    });
    return toStudio(estudio);
  }

  /** Saldo que banca os testes "até desativar". Nunca fica negativo. */
  async adjustStudioBalance(actor: RequestUser, studioId: string, dto: BalanceAdjustmentDto): Promise<{ balanceCents: number }> {
    await this.studioOf(studioId);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.studio.updateMany({
        where: { id: studioId, ...(dto.amountCents < 0 ? { balanceCents: { gte: -dto.amountCents } } : {}) },
        data: { balanceCents: { increment: dto.amountCents } },
      });
      if (count === 0) throw new UnprocessableEntityException({ message: 'O saldo do estúdio ficaria negativo.' });

      await this.audit.record(
        { actorId: actor.id, action: 'studio.balance', targetType: 'studio', targetId: studioId, data: { amountCents: dto.amountCents, note: dto.note } },
        tx,
      );
      const estudio = await tx.studio.findUniqueOrThrow({ where: { id: studioId }, select: { balanceCents: true } });
      return { balanceCents: estudio.balanceCents };
    });
  }

  async listWithdrawals(query: ListWithdrawalsQueryDto): Promise<{ items: AdminWithdrawalRow[]; total: number }> {
    const where: Prisma.WithdrawalWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        include: { player: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...toWithdrawalInfo(r), player: r.player })), total };
  }

  /**
   * Paga ou recusa um saque. Recusado, o valor volta ao saldo. Pago, as
   * recompensas validadas mais antigas que ele cobre viram PAID.
   */
  async processWithdrawal(actor: RequestUser, id: string, dto: ProcessWithdrawalDto): Promise<AdminWithdrawalRow> {
    const saque = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawal.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: dto.status, note: dto.note, processedAt: new Date(), processedById: actor.id },
      });
      if (count === 0) {
        const existe = await tx.withdrawal.findUnique({ where: { id }, select: { id: true } });
        if (!existe) throw new NotFoundException({ message: 'Saque não encontrado.' });
        throw new ConflictException({ message: 'Este saque já foi processado.' });
      }
      const atual = await tx.withdrawal.findUniqueOrThrow({ where: { id } });

      if (dto.status === 'REJECTED') {
        await tx.playerProfile.update({ where: { userId: atual.playerId }, data: { balanceCents: { increment: atual.amountCents } } });
        await tx.ledgerEntry.updateMany({ where: { withdrawalId: id }, data: { status: 'CANCELED' } });
      } else {
        const validadas = await tx.participation.findMany({
          where: { playerId: atual.playerId, rewardStatus: 'VALIDATED' },
          orderBy: { finishedAt: 'asc' },
          select: { id: true, rewardCents: true },
        });
        let restante = atual.amountCents;
        const pagas: string[] = [];
        for (const p of validadas) {
          if (p.rewardCents > restante) break;
          restante -= p.rewardCents;
          pagas.push(p.id);
        }
        if (pagas.length) await tx.participation.updateMany({ where: { id: { in: pagas } }, data: { rewardStatus: 'PAID' } });
      }

      await this.audit.record(
        { actorId: actor.id, action: `withdrawal.${dto.status.toLowerCase()}`, targetType: 'withdrawal', targetId: id, data: { note: dto.note } },
        tx,
      );
      await this.notifications.notify(
        atual.playerId,
        dto.status === 'PAID'
          ? { type: 'WITHDRAWAL_PAID', title: 'Saque pago!', body: `${formatBRL(atual.amountCents)} foram enviados para a sua chave Pix.`, link: '/player/wallet', data: { withdrawalId: id } }
          : {
              type: 'WITHDRAWAL_REJECTED',
              title: 'Saque recusado',
              body: `${formatBRL(atual.amountCents)} voltaram para o seu saldo.${dto.note ? ` Motivo: ${dto.note}` : ''}`,
              link: '/player/wallet',
              data: { withdrawalId: id },
            },
        tx,
      );
      return tx.withdrawal.findUniqueOrThrow({ where: { id }, include: { player: { select: { id: true, name: true, email: true } } } });
    });
    return { ...toWithdrawalInfo(saque), player: saque.player };
  }

  private async userOf(id: string): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: comEstudio });
    if (!user) throw new NotFoundException({ message: 'Usuário não encontrado.' });
    return user;
  }

  private async studioOf(studioId: string | undefined) {
    if (!studioId) {
      throw new BadRequestException({
        message: 'Confira os campos destacados.',
        code: ErrorCode.VALIDATION_ERROR,
        fields: { studioId: 'Escolha o estúdio da conta.' },
      });
    }
    const estudio = await this.prisma.studio.findUnique({ where: { id: studioId } });
    if (!estudio) throw new NotFoundException({ message: 'Estúdio não encontrado.' });
    return estudio;
  }

  private async assertEmailFree(email: string) {
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({
        message: 'Já existe uma conta com este e-mail.',
        code: ErrorCode.EMAIL_TAKEN,
        fields: { email: 'Já existe uma conta com este e-mail.' },
      });
    }
  }

  /** Admin cuida da plataforma, mas não de Owners (RN-01). */
  private assertMayManage(actor: RequestUser, alvo: { role: UserRole }) {
    if (actor.role === 'ADMIN' && alvo.role === 'OWNER') {
      throw new ForbiddenException({ message: 'Só um Owner altera outro Owner.', code: ErrorCode.ROLE_NOT_ALLOWED });
    }
  }

  private assertMayGrant(actor: RequestUser, role: UserRole) {
    if (actor.role === 'ADMIN' && role === 'OWNER') {
      throw new ForbiddenException({ message: 'Só um Owner promove outra conta a Owner.', code: ErrorCode.ROLE_NOT_ALLOWED });
    }
  }

  /** A plataforma nunca fica sem Owner ativo (RN-03). */
  private async assertNotLastOwner(ownerId: string) {
    const outros = await this.prisma.user.count({ where: { role: 'OWNER', status: 'ACTIVE', id: { not: ownerId } } });
    if (!outros) {
      throw new UnprocessableEntityException({
        message: 'A plataforma precisa de pelo menos um Owner ativo.',
        code: ErrorCode.LAST_OWNER,
      });
    }
  }
}

function toRow(user: UserRow): AdminUserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl ?? undefined,
    studio: user.studio ? { id: user.studio.id, name: user.studio.name, permission: user.studioPermission ?? 'VIEW' } : null,
    createdAt: user.createdAt.toISOString(),
  };
}

function toStudio(estudio: Prisma.StudioGetPayload<{ include: { _count: { select: { members: true; games: true } } } }>): StudioSummary {
  return {
    id: estudio.id,
    name: estudio.name,
    cnpj: estudio.cnpj,
    website: estudio.website,
    members: estudio._count.members,
    games: estudio._count.games,
    createdAt: estudio.createdAt.toISOString(),
  };
}
