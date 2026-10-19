import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { GameAccessEntry, StudioGroup, StudioMember, StudioTeam } from '../../contracts';
import {
  GameAccessDto,
  GroupDto,
  GroupMembersDto,
  InviteMemberDto,
  ListMembersQueryDto,
  UpdateGroupDto,
  UpdateMemberDto,
} from './dto/team.dto';
import { TeamService } from './team.service';

/** Membros e grupos do estúdio. Ler é de qualquer membro; mudar a equipe é de quem tem MANAGE. */
@Roles('STUDIO')
@Controller('studio')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Grupos e membros resumidos para o passo Permissões do Novo jogo. */
  @Get('team')
  studioTeam(@CurrentUser() user: RequestUser): Promise<StudioTeam> {
    return this.team.teamOf(user);
  }

  @Get('members')
  listMembers(@CurrentUser() user: RequestUser, @Query() query: ListMembersQueryDto): Promise<StudioMember[]> {
    return this.team.listMembers(user, query);
  }

  @RequireStudioPermission('MANAGE')
  @Idempotent()
  @Post('members')
  invite(@CurrentUser() user: RequestUser, @Body() dto: InviteMemberDto): Promise<StudioMember> {
    return this.team.inviteMember(user, dto);
  }

  @RequireStudioPermission('MANAGE')
  @Patch('members/:id')
  updateMember(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateMemberDto): Promise<StudioMember> {
    return this.team.updateMember(user, id, dto);
  }

  @RequireStudioPermission('MANAGE')
  @Delete('members/:id')
  removeMember(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ removed: true }> {
    return this.team.removeMember(user, id);
  }

  @Get('groups')
  listGroups(@CurrentUser() user: RequestUser): Promise<StudioGroup[]> {
    return this.team.listGroups(user);
  }

  @RequireStudioPermission('MANAGE')
  @Post('groups')
  createGroup(@CurrentUser() user: RequestUser, @Body() dto: GroupDto): Promise<StudioGroup> {
    return this.team.createGroup(user, dto);
  }

  @RequireStudioPermission('MANAGE')
  @Patch('groups/:id')
  updateGroup(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateGroupDto): Promise<StudioGroup> {
    return this.team.updateGroup(user, id, dto);
  }

  @RequireStudioPermission('MANAGE')
  @Put('groups/:id/members')
  setGroupMembers(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: GroupMembersDto): Promise<StudioGroup> {
    return this.team.setGroupMembers(user, id, dto.memberIds);
  }

  @RequireStudioPermission('MANAGE')
  @Delete('groups/:id')
  removeGroup(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ deleted: true }> {
    return this.team.removeGroup(user, id);
  }
}

/** "Responsáveis e permissões" do jogo (Figma `1187:9418`). */
@Roles('STUDIO')
@Controller('games/:gameId/access')
export class GameAccessController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<GameAccessEntry[]> {
    return this.team.getGameAccess(user, gameId);
  }

  /** Troca a tabela inteira. Quem pode: MANAGE_ACCESS no jogo. */
  @RequireStudioPermission('EDIT')
  @Put()
  replace(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string, @Body() dto: GameAccessDto): Promise<GameAccessEntry[]> {
    return this.team.setGameAccess(user, gameId, dto);
  }
}
