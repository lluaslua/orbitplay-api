import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../common/security/password-policy';
import { UI_LOCALES } from '../../common/constants/domain.constants';
import type { ChangePasswordPayload, UpdateMePayload } from '../../contracts';

export class UpdateMeDto implements UpdateMePayload {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MaxLength(120)
  name?: string;

  /** O seletor "PT" da navbar. */
  @IsOptional()
  @IsIn(UI_LOCALES)
  locale?: string;
}

export class ChangePasswordDto implements ChangePasswordPayload {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  /** A mesma regra do cadastro. */
  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
