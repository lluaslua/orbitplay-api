import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/security/password-policy';
import type { ResetPasswordPayload } from '../../../contracts';

export class ResetPasswordDto implements ResetPasswordPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @IsString()
  @IsStrongPassword()
  password: string;
}
