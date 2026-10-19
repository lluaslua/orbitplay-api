import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { SessionValidationPayload } from '../../../contracts';

export class SessionValidationDto implements SessionValidationPayload {
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
