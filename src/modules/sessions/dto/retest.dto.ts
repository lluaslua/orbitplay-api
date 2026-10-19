import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { RetestPayload } from '../../../contracts';

export class RetestDto implements RetestPayload {
  /** Outro teste ativo do mesmo jogo. Sem ele, vai o mais recente que o tester ainda não fez. */
  @IsOptional()
  @IsString()
  testId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
