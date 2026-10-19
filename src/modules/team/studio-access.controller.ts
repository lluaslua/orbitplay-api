import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { AccessGroup, AccessOverview, AccessUser } from '../../contracts';
import {
  AccessGroupDto,
  InviteAccessUserDto,
  SetAccessPasswordDto,
  UpdateAccessGroupDto,
  UpdateAccessUserDto,
} from './dto/studio-access.dto';
import { StudioAccessService } from './studio-access.service';

/**
 * "Gerenciamento de acessos" do menu do avatar (`/studio/access` no app).
 * Só o estúdio entra; o que cada um pode mudar é decidido no service.
 */
@Roles('STUDIO')
@Controller('studio/access')
export class StudioAccessController {
  constructor(private readonly acessos: StudioAccessService) {}

  @Get()
  overview(@CurrentUser() user: RequestUser): Promise<AccessOverview> {
    return this.acessos.overview(user);
  }

  @Post('users')
  invite(@CurrentUser() user: RequestUser, @Body() dto: InviteAccessUserDto): Promise<AccessUser> {
    return this.acessos.invite(user, dto);
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateAccessUserDto): Promise<AccessUser> {
    return this.acessos.updateUser(user, id, dto);
  }

  @HttpCode(200)
  @Post('users/:id/password')
  setPassword(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetAccessPasswordDto): Promise<{ message: string }> {
    return this.acessos.setPassword(user, id, dto);
  }

  @Delete('users/:id')
  removeUser(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ id: string }> {
    return this.acessos.removeUser(user, id);
  }

  @Post('groups')
  createGroup(@CurrentUser() user: RequestUser, @Body() dto: AccessGroupDto): Promise<AccessGroup> {
    return this.acessos.createGroup(user, dto);
  }

  @Patch('groups/:id')
  updateGroup(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateAccessGroupDto): Promise<AccessGroup> {
    return this.acessos.updateGroup(user, id, dto);
  }

  @Delete('groups/:id')
  removeGroup(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ id: string }> {
    return this.acessos.removeGroup(user, id);
  }
}
