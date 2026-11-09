import { IsEmail } from 'class-validator';
import type { ResendCodePayload } from '../../../contracts';

export class ResendCodeDto implements ResendCodePayload {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;
}
