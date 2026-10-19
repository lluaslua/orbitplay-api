import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { VIDEO_MAX_BYTES, videoFilter } from '../../common/storage/upload-filters';
import { ConsentDto } from './dto/consent.dto';
import { EventsDto } from './dto/events.dto';
import { ProgressDto } from './dto/progress.dto';
import { GameplayService } from './gameplay.service';

/** O `:id` é o da participação que `POST /player/tests/:testId/start` devolve. */
@Roles('PLAYER')
@Controller('player/participations/:id')
export class GameplayController {
  constructor(private readonly gameplay: GameplayService) {}

  @Post('consent')
  @HttpCode(HttpStatus.OK)
  consent(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: ConsentDto): Promise<{ consentAt: string }> {
    return this.gameplay.consent(user, id, dto);
  }

  @Patch('progress')
  progress(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: ProgressDto): Promise<{ progress: number }> {
    return this.gameplay.progress(user, id, dto.progress);
  }

  /** Em lote: o app e o plug-in acumulam e mandam de tempos em tempos. */
  @Post('events')
  events(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: EventsDto): Promise<{ received: number }> {
    return this.gameplay.events(user, id, dto.events);
  }

  /** Multipart com o vídeo no campo `file`. */
  @Post('recording')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VIDEO_MAX_BYTES }, fileFilter: videoFilter }))
  recording(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ uploaded: true }> {
    if (!file) throw new BadRequestException({ message: 'Envie a gravação no campo "file".' });
    return this.gameplay.recording(user, id, file);
  }
}
