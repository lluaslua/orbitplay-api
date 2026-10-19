import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Notification as NotificationRow } from '@prisma/client';
import { GameAccessService } from '../../common/access/game-access.service';
import { pageArgs, type PaginationQueryDto } from '../../common/pagination/pagination';
import type { GamePermission, Notification, NotificationType } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';

type Cliente = PrismaService | Prisma.TransactionClient;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
}

/**
 * O sino da navbar. Quem gera a notificação passa o cliente da transação: ela
 * sai junto com o que aconteceu, ou não sai.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GameAccessService,
  ) {}

  /** Para a equipe do jogo com a permissão — ex.: quem acessa relatórios recebe "relatório pronto". */
  async notifyGameTeam(gameId: string, permission: GamePermission, input: NotificationInput, client: Cliente = this.prisma): Promise<void> {
    await this.notify(await this.access.usersWith(gameId, permission, client), input, client);
  }

  /** Relatório fechado: o teste acabou de ir a FINISHED. */
  async reportReady(playtestId: string, client: Cliente = this.prisma): Promise<void> {
    const teste = await client.playtest.findUnique({ where: { id: playtestId }, select: { id: true, gameId: true, title: true } });
    if (!teste) return;
    await this.notifyGameTeam(
      teste.gameId,
      'VIEW_REPORTS',
      {
        type: 'REPORT_READY',
        title: 'Relatório pronto',
        body: `A análise de "${teste.title}" terminou. O relatório final já pode ser aberto.`,
        link: `/studio/reports/${teste.id}`,
        data: { testId: teste.id, gameId: teste.gameId },
      },
      client,
    );
  }

  async notify(userIds: string | string[], input: NotificationInput, client: Cliente = this.prisma): Promise<void> {
    const destino = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (!destino.length) return;
    await client.notification.createMany({
      data: destino.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        data: input.data ? (JSON.parse(JSON.stringify(input.data)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      })),
    });
  }

  async list(userId: string, query: PaginationQueryDto & { unread?: boolean }): Promise<{ items: Notification[]; total: number }> {
    const where: Prisma.NotificationWhereInput = { userId, ...(query.unread ? { readAt: null } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows.map(toNotification), total };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException({ message: 'Notificação não encontrada.' });
    const lida = row.readAt ? row : await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return toNotification(lida);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    link: row.link,
    data: (row.data as Record<string, unknown> | null) ?? null,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
