import { IsEmail } from 'class-validator';

export class RecoverPasswordDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;
}
