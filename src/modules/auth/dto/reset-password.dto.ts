import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import type { ResetPasswordPayload } from '../../../contracts';

export class ResetPasswordDto implements ResetPasswordPayload {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres.' })
  @MaxLength(72)
  password: string;
}
