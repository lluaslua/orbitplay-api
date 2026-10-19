import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto, setTotal } from '../../common/pagination/pagination';
import type { Notification } from '../../contracts';
import { NotificationsService } from './notifications.service';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  /** `?unread=true` traz só as não lidas. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unread?: boolean;
}

/** Vale para qualquer perfil: cada um vê só as suas. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListNotificationsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Notification[]> {
    const { items, total } = await this.notifications.list(user.id, query);
    setTotal(response, total);
    return items;
  }

  /** O número da bolinha do sino. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: RequestUser): Promise<{ unread: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentUser() user: RequestUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Notification> {
    return this.notifications.markRead(user.id, id);
  }
}
