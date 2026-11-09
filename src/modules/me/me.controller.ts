import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { RateLimit } from '../../common/security/rate-limit.guard';
import { IMAGE_MAX_BYTES, imageFilter } from '../../common/storage/upload-filters';
import type { AuthSession, AuthUser } from '../../contracts';
import { ChangePasswordDto, UpdateMeDto } from './me.dto';
import { MeService } from './me.service';

/** A própria conta. A leitura continua em `GET /auth/me`. */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Patch()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateMeDto): Promise<AuthUser> {
    return this.me.update(user, dto);
  }

  /** Multipart com a foto no campo `file`. */
  @RateLimit({ limit: 10, windowMs: 3_600_000, by: 'user' })
  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES }, fileFilter: imageFilter }))
  avatar(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File | undefined): Promise<AuthUser> {
    if (!file) throw new BadRequestException({ message: 'Envie a imagem no campo "file".' });
    return this.me.uploadAvatar(user, file);
  }

  @RateLimit({ limit: 5, windowMs: 900_000, by: 'user' })
  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto): Promise<AuthSession> {
    return this.me.changePassword(user, dto);
  }
}
