import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { IsStrongPassword } from '../../common/security/password-policy';
import { TEST_LOCATIONS, UI_LOCALES } from '../../common/constants/domain.constants';
import type { ChangePasswordPayload, TestLocation, UpdateMePayload } from '../../contracts';

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

  @IsOptional()
  @IsISO8601({}, { message: 'Informe uma data válida.' })
  birthDate?: string;

  @IsOptional()
  @IsIn(TEST_LOCATIONS, { message: 'Escolha o país.' })
  location?: TestLocation;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaEnabled?: boolean;

  /** Só estúdio: "Cargo / função". */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  jobTitle?: string;

  /** Só estúdio MANAGE: "Nome do Estúdio". */
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do estúdio.' })
  @MaxLength(120)
  organization?: string;

  /** Só estúdio MANAGE: "Site". Vazio apaga. */
  @IsOptional()
  @ValidateIf((dto: UpdateMeDto) => dto.website !== '')
  @IsUrl({}, { message: 'Informe um endereço válido, com http:// ou https://.' })
  website?: string;
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
