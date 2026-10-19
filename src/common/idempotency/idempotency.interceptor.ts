import {
  BadRequestException,
  ConflictException,
  Injectable,
  RequestMethod,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { from, mergeMap, of, throwError, catchError, type Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

/**
 * Proteção contra repetição das ações críticas — pagamento, publicação de
 * teste, envio de sessão e saque (Handoff: "Ações críticas").
 *
 * A primeira requisição com uma chave grava um marcador; enquanto ela roda,
 * outra com a mesma chave recebe 409; depois, recebe a mesma resposta. Se a
 * primeira falhar, o marcador sai e a chave pode ser usada de novo. Sem o
 * cabeçalho a rota roda normalmente — cada service ainda tem a sua regra de
 * domínio (um pedido por teste, uma sessão por participação...).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler())) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = request.header('idempotency-key')?.trim();
    if (!key || !request.user) return next.handle();
    if (key.length > 200) throw new BadRequestException({ message: 'Idempotency-Key longa demais.' });

    const userId = request.user.id;
    const route = `${request.method} ${request.originalUrl.split('?')[0]}`;
    const where = { userId_key: { userId, key } };

    const anterior = await this.prisma.idempotencyRecord.findUnique({ where });
    if (anterior) {
      if (anterior.route !== route) {
        throw new UnprocessableEntityException({
          message: 'Esta Idempotency-Key já foi usada em outra operação.',
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      if (anterior.statusCode === null) throw emAndamento();
      return of(anterior.body);
    }

    try {
      await this.prisma.idempotencyRecord.create({ data: { userId, key, route } });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') throw emAndamento();
      throw erro;
    }

    const statusCode = this.statusOf(context, request.method);

    return next.handle().pipe(
      mergeMap(async (body) => {
        await this.prisma.idempotencyRecord.update({
          where,
          data: { statusCode, body: JSON.parse(JSON.stringify(body ?? null)) as Prisma.InputJsonValue },
        });
        return body;
      }),
      catchError((erro: unknown) =>
        from(this.prisma.idempotencyRecord.delete({ where }).catch(() => undefined)).pipe(
          mergeMap(() => throwError(() => erro)),
        ),
      ),
    );
  }

  /** O mesmo que o Nest vai responder: o @HttpCode da rota, ou 201 no POST. */
  private statusOf(context: ExecutionContext, method: string): number {
    const declarado = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    if (declarado) return declarado;
    return method === RequestMethod[RequestMethod.POST] ? 201 : 200;
  }
}

function emAndamento() {
  return new ConflictException({
    message: 'A mesma operação ainda está em andamento.',
    code: 'IDEMPOTENCY_IN_PROGRESS',
  });
}
