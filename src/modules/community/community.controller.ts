import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { ChatMessage, GameCommunity } from '../../contracts';
import { CommunityAccessGuard } from './community-access.guard';
import { CommunityService } from './community.service';
import { ListMessagesQueryDto, SendMessageDto } from './dto/send-message.dto';

/** O mesmo chat para estúdio e tester (Figma `395:2656`); quem entra, o guard decide. */
@UseGuards(CommunityAccessGuard)
@Controller('games/:gameId/community')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get()
  getCommunity(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<GameCommunity> {
    return this.community.getCommunity(gameId, user);
  }

  @Get('channels/:channelId/messages')
  listMessages(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('channelId') channelId: string,
    @Query() cursor: ListMessagesQueryDto,
  ): Promise<ChatMessage[]> {
    return this.community.listMessages(gameId, channelId, user, cursor);
  }

  @Post('channels/:channelId/messages')
  sendMessage(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('channelId') channelId: string,
    @Body() { text }: SendMessageDto,
  ): Promise<ChatMessage> {
    return this.community.sendMessage(gameId, channelId, user, text);
  }

  @Post('messages/:messageId/reaction')
  @HttpCode(HttpStatus.OK)
  toggleReaction(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('messageId') messageId: string,
  ): Promise<ChatMessage> {
    return this.community.toggleReaction(gameId, messageId, user);
  }

  @Delete('messages/:messageId')
  deleteMessage(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('messageId') messageId: string,
  ): Promise<{ deleted: true }> {
    return this.community.deleteMessage(gameId, messageId, user);
  }
}
