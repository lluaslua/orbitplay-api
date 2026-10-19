import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { GAME_PERMISSIONS, STUDIO_PERMISSIONS } from '../../../common/constants/domain.constants';
import type {
  GameAccessPayload,
  GamePermission,
  GroupPayload,
  InviteMemberPayload,
  StudioPermission,
  UpdateMemberPayload,
} from '../../../contracts';

export class ListMembersQueryDto {
  /** Busca por nome ou e-mail; aceita o "@" do campo "Pesquise...". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class InviteMemberDto implements InviteMemberPayload {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome.' })
  @MaxLength(120)
  name: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsOptional()
  @IsIn(STUDIO_PERMISSIONS)
  permission?: StudioPermission;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupIds?: string[];
}

export class UpdateMemberDto implements UpdateMemberPayload {
  @IsOptional()
  @IsIn(STUDIO_PERMISSIONS)
  permission?: StudioPermission;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupIds?: string[];
}

export class GroupDto implements GroupPayload {
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome ao grupo.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome ao grupo.' })
  @MaxLength(60)
  name?: string;
}

export class GroupMembersDto {
  @IsArray()
  @IsString({ each: true })
  memberIds: string[];
}

export class GameAccessEntryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsArray()
  @IsIn(GAME_PERMISSIONS, { each: true })
  permissions: GamePermission[];
}

export class GameAccessDto implements GameAccessPayload {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GameAccessEntryDto)
  entries: GameAccessEntryDto[];
}
