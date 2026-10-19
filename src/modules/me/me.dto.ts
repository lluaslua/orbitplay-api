import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
  currentPassword: string;

  /** A mesma regra do cadastro. */
  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres.' })
  @MaxLength(72)
  newPassword: string;
}
