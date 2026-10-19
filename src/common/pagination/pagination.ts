import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';

/** `?page=2&pageSize=20`. Sem `page`, a lista vem inteira até o teto. */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Teto de uma lista pedida sem `page` — é como o app pede hoje. */
const TETO_SEM_PAGINA = 500;

export function pageArgs(query: PaginationQueryDto): { skip: number; take: number } {
  if (!query.page) return { skip: 0, take: TETO_SEM_PAGINA };
  const pageSize = query.pageSize ?? 20;
  return { skip: (query.page - 1) * pageSize, take: pageSize };
}

/**
 * O total vai no cabeçalho `X-Total-Count`, e o corpo continua sendo a lista
 * que o app espera — paginar não quebra quem não pagina (Handoff, Tela 05).
 */
export function setTotal(response: Response, total: number): void {
  response.setHeader('X-Total-Count', String(total));
}
