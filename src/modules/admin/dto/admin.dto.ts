import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  NotEquals,
} from 'class-validator';
import { STUDIO_PERMISSIONS, USER_ROLES } from '../../../common/constants/domain.constants';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import type {
  CreateStudioPayload,
  CreateUserPayload,
  ProcessWithdrawalPayload,
  StudioPermission,
  UpdateUserPayload,
  UpdateUserRolePayload,
  UpdateUserStatusPayload,
  UserRole,
  UserStatus,
  WithdrawalStatus,
} from '../../../contracts';

export class ListUsersQueryDto extends PaginationQueryDto {
  /** Nome ou e-mail. */
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(USER_ROLES) role?: UserRole;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'PENDING']) status?: UserStatus;
}

export class CreateUserDto implements CreateUserPayload {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail({}, { message: 'Informe um e-mail válido.' }) email: string;
  @IsIn(USER_ROLES) role: UserRole;
  @IsOptional() @IsString() studioId?: string;
  @IsOptional() @IsIn(STUDIO_PERMISSIONS) studioPermission?: StudioPermission;
}

export class UpdateUserDto implements UpdateUserPayload {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail({}, { message: 'Informe um e-mail válido.' }) email?: string;
  @IsOptional() @IsString() studioId?: string | null;
  @IsOptional() @IsIn(STUDIO_PERMISSIONS) studioPermission?: StudioPermission | null;
}

export class UpdateUserStatusDto implements UpdateUserStatusPayload {
  @IsIn(['ACTIVE', 'INACTIVE']) status: 'ACTIVE' | 'INACTIVE';
}

export class UpdateUserRoleDto implements UpdateUserRolePayload {
  @IsIn(USER_ROLES) role: UserRole;
}

export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() targetType?: string;
  @IsOptional() @IsString() targetId?: string;
}

export class CreateStudioDto implements CreateStudioPayload {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(20) cnpj?: string;
  @IsOptional() @IsUrl({}, { message: 'Informe um endereço válido, com http:// ou https://.' }) website?: string;
}

/** Crédito (positivo) ou débito (negativo) no saldo do estúdio — sempre com motivo. */
export class BalanceAdjustmentDto {
  @IsInt() @NotEquals(0) amountCents: number;
  @IsString() @IsNotEmpty() @MaxLength(300) note: string;
}

export class ListWithdrawalsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['REQUESTED', 'PAID', 'REJECTED']) status?: WithdrawalStatus;
}

export class ProcessWithdrawalDto implements ProcessWithdrawalPayload {
  @IsIn(['PAID', 'REJECTED']) status: 'PAID' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
