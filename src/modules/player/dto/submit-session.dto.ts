import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { SessionSubmission } from '../../../contracts';

/** Enviado ao concluir a sessão (TELA 18 → TELA 19). */
export class SubmitSessionDto implements SessionSubmission {
  @IsString()
  @MaxLength(64)
  participationId: string;

  /** Resposta por id de pergunta — texto, número, lista ou sim/não, conforme o tipo. */
  @IsObject()
  answers: Record<string, string | number | string[] | boolean>;

  @IsInt()
  @Min(0)
  @Max(50)
  bugsReported: number;

  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSeconds: number;

  /** Tempo no formulário — vira o "Tempo médio da avaliação" do relatório. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  formSeconds?: number;
}
