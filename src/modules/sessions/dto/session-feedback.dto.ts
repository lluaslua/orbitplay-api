import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { SessionFeedbackPayload } from '../../../contracts';

export class SessionFeedbackDto implements SessionFeedbackPayload {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
