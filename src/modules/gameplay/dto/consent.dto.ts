import { IsBoolean } from 'class-validator';
import type { ConsentPayload } from '../../../contracts';

export class ConsentDto implements ConsentPayload {
  @IsBoolean()
  recording: boolean;

  @IsBoolean()
  microphone: boolean;

  @IsBoolean()
  webcam: boolean;
}
