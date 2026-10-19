import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { setTotal } from '../../common/pagination/pagination';
import type { AdminUserRow, AdminWithdrawalRow, AuditLogEntry, StudioSummary } from '../../contracts';
import { AdminService } from './admin.service';
import {
  AuditQueryDto,
  BalanceAdjustmentDto,
  CreateStudioDto,
  CreateUserDto,
  ListUsersQueryDto,
  ListWithdrawalsQueryDto,
  ProcessWithdrawalDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

/** Exclusiva de Owner e Admin (Handoff, Tela 20 RN-01). */
@Roles('OWNER', 'ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  async listUsers(@Query() query: ListUsersQueryDto, @Res({ passthrough: true }) response: Response): Promise<AdminUserRow[]> {
    const { items, total } = await this.admin.listUsers(query);
    setTotal(response, total);
    return items;
  }

  @Idempotent()
  @Post('users')
  createUser(@CurrentUser() actor: RequestUser, @Body() dto: CreateUserDto): Promise<AdminUserRow> {
    return this.admin.createUser(actor, dto);
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() actor: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserDto): Promise<AdminUserRow> {
    return this.admin.updateUser(actor, id, dto);
  }

  @Patch('users/:id/status')
  setStatus(@CurrentUser() actor: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserStatusDto): Promise<AdminUserRow> {
    return this.admin.setStatus(actor, id, dto.status);
  }

  @Patch('users/:id/role')
  setRole(@CurrentUser() actor: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserRoleDto): Promise<AdminUserRow> {
    return this.admin.setRole(actor, id, dto.role);
  }

  @Post('users/:id/password-reset')
  @HttpCode(HttpStatus.OK)
  passwordReset(@CurrentUser() actor: RequestUser, @Param('id') id: string): Promise<{ message: string }> {
    return this.admin.sendPasswordReset(actor, id);
  }

  @Get('audit-logs')
  async auditLogs(@Query() query: AuditQueryDto, @Res({ passthrough: true }) response: Response): Promise<AuditLogEntry[]> {
    const { items, total } = await this.admin.listAuditLogs(query);
    setTotal(response, total);
    return items;
  }

  @Get('studios')
  listStudios(): Promise<StudioSummary[]> {
    return this.admin.listStudios();
  }

  @Post('studios')
  createStudio(@CurrentUser() actor: RequestUser, @Body() dto: CreateStudioDto): Promise<StudioSummary> {
    return this.admin.createStudio(actor, dto);
  }

  @Idempotent()
  @Post('studios/:id/balance')
  @HttpCode(HttpStatus.OK)
  adjustBalance(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: BalanceAdjustmentDto,
  ): Promise<{ balanceCents: number }> {
    return this.admin.adjustStudioBalance(actor, id, dto);
  }

  @Get('withdrawals')
  async listWithdrawals(
    @Query() query: ListWithdrawalsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminWithdrawalRow[]> {
    const { items, total } = await this.admin.listWithdrawals(query);
    setTotal(response, total);
    return items;
  }

  @Patch('withdrawals/:id')
  processWithdrawal(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
  ): Promise<AdminWithdrawalRow> {
    return this.admin.processWithdrawal(actor, id, dto);
  }
}
