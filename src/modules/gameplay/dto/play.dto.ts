import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import type { PlayClosePayload, PlayHeartbeatPayload } from '../../../contracts';

export class PlayHeartbeatDto implements PlayHeartbeatPayload {
  @IsInt()
  @Min(0)
  @Max(3600)
  activeSeconds: number;
}

export class PlayCloseDto implements PlayClosePayload {
  @IsInt()
  @Min(0)
  @Max(3600)
  activeSeconds: number;

  /** O Windows dá códigos como 0xC0000005: o app manda em 32 bits com sinal. */
  @ValidateIf((_dto, valor) => valor !== null)
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  exitCode: number | null;
}
