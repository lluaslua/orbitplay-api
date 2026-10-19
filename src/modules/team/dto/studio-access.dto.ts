import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AccessGroupPatch, AccessPermissions, AccessUserPatch } from '../../../contracts';

/** "Novo usuário" de Gerenciamento de acessos: só o e-mail; o nome sai dele até a pessoa entrar. */
export class InviteAccessUserDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email: string;
}

export class AccessPermissionsDto implements Partial<AccessPermissions> {
  @IsOptional() @IsBoolean() manageUsers?: boolean;
  @IsOptional() @IsBoolean() deleteUsers?: boolean;
}

/** Suspender/Restabelecer e as duas colunas de permissão da tabela. */
export class UpdateAccessUserDto implements AccessUserPatch {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @ValidateNested()
  @Type(() => AccessPermissionsDto)
  permissions?: AccessPermissionsDto;
}

/**
 * "Redefinir senha" — a mesma regra do modal (`senhaValida` no app): 8 ou mais
 * caracteres com maiúscula, minúscula, número e símbolo.
 */
export class SetAccessPasswordDto {
  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres.' })
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])[\x20-\x7E]+$/, {
    message: 'A senha não atende aos requisitos.',
  })
  password: string;
}

export class AccessGroupDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do grupo.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  memberIds?: string[];
}

export class UpdateAccessGroupDto implements AccessGroupPatch {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do grupo.' })
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  memberIds?: string[];
}
