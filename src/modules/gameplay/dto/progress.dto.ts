import { IsNumber, Max, Min } from 'class-validator';
import type { ProgressPayload } from '../../../contracts';

export class ProgressDto implements ProgressPayload {
  @IsNumber()
  @Min(0)
  @Max(1)
  progress: number;
}
