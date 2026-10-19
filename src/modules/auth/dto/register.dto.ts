import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ARCHETYPE_IDS,
  LOGIN_TABS,
  PLAYER_TYPE_IDS,
  TEST_LOCATIONS,
} from '../../../common/constants/domain.constants';
import type {
  ArchetypeId,
  LoginTab,
  PlayerTypeId,
  RegisterPayload,
  TestLocation,
} from '../../../contracts';

export class RegisterDto implements RegisterPayload {
  @IsIn(LOGIN_TABS)
  role: LoginTab;

  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MaxLength(120)
  name: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  /** O bcrypt só considera os primeiros 72 bytes. */
  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres.' })
  @MaxLength(72)
  password: string;

  @ValidateIf((dto: RegisterDto) => dto.role === 'STUDIO')
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do estúdio.' })
  @MaxLength(120)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpj?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Informe um endereço válido, com http:// ou https://.' })
  website?: string;

  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsIn(TEST_LOCATIONS)
  location?: TestLocation;

  @IsOptional()
  @IsIn(PLAYER_TYPE_IDS)
  playerType?: PlayerTypeId;

  @IsOptional()
  @IsIn(ARCHETYPE_IDS)
  archetype?: ArchetypeId;
}
