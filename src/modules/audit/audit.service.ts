import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Cliente = PrismaService | Prisma.TransactionClient;

/**
 * Registro de auditoria: quem fez, o quê, em quem e quando (Handoff, Tela 20
 * RN-05). Aceita o cliente da transação para o registro sair junto com a
 * mudança — ou nenhum dos dois.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: { actorId: string; action: string; targetType: string; targetId: string; data?: Record<string, unknown> },
    client: Cliente = this.prisma,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        data: entry.data ? (JSON.parse(JSON.stringify(entry.data)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }
}
