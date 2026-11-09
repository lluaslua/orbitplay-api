import { IsBoolean, IsEmail, IsOptional, Matches } from 'class-validator';
import type { VerifyEmailPayload, VerifyLoginPayload } from '../../../contracts';

export class VerifyEmailDto implements VerifyEmailPayload {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @Matches(/^\d{6}$/, { message: 'Digite os 6 dígitos do código.' })
  code: string;
}

/** O mesmo código, no segundo passo do login com MFA. */
export class VerifyLoginDto extends VerifyEmailDto implements VerifyLoginPayload {
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
