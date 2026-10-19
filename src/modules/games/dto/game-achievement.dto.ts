import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { GAME_ACHIEVEMENT_RULES } from '../../../common/constants/domain.constants';
import type { GameAchievementPayload } from '../../../contracts';

const REGRAS = Object.keys(GAME_ACHIEVEMENT_RULES);

export class GameAchievementDto implements GameAchievementPayload {
  @IsString()
  @IsNotEmpty({ message: 'Dê um título à conquista.' })
  @MaxLength(80)
  title: string;

  @IsString()
  @MaxLength(240)
  description: string;

  /** Prefixo do ícone em `public/icons/figma/conquista/` no app. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string;

  /** `null` ou ausente: a conquista é dada à mão. */
  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsIn(REGRAS, { message: 'Regra desconhecida.' })
  rule?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateGameAchievementDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsString() @MaxLength(80) icon?: string;

  @IsOptional()
  @ValidateIf((_, valor) => valor !== null)
  @IsIn(REGRAS, { message: 'Regra desconhecida.' })
  rule?: string | null;

  @IsOptional() @IsInt() @Min(0) position?: number;
}
