import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { buildFilter } from '../../common/storage/upload-filters';
import type { BuildInfo } from '../../contracts';
import { BuildsService } from './builds.service';
import { UpdateBuildDto, UpdatePluginDto } from './dto/update-plugin.dto';
import { UploadBuildDto } from './dto/upload-build.dto';

/** Etapa 3 do Novo teste: upload da build e configuração do Orbit Plug-in. */
@Roles('STUDIO')
@Controller('games/:gameId/builds')
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<BuildInfo[]> {
    return this.builds.list(user, gameId);
  }

  /** Multipart: o arquivo no campo `file` e a versão no campo `version`. */
  @RequireStudioPermission('EDIT')
  @Post()
  @UseInterceptors(FileInterceptor('file', { fileFilter: buildFilter }))
  upload(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Body() dto: UploadBuildDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BuildInfo> {
    if (!file) throw new BadRequestException({ message: 'Envie a build no campo "file".' });
    return this.builds.upload(user, gameId, file, dto.version);
  }

  /** O app consulta enquanto o status for PROCESSING. */
  @Get(':buildId')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('buildId') buildId: string,
  ): Promise<BuildInfo> {
    return this.builds.findOne(user, gameId, buildId);
  }

  /** Ajusta os sistemas em que a build roda ("Compatível com MAC / Windows"). */
  @RequireStudioPermission('EDIT')
  @Patch(':buildId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('buildId') buildId: string,
    @Body() dto: UpdateBuildDto,
  ): Promise<BuildInfo> {
    return this.builds.update(user, gameId, buildId, dto);
  }

  @RequireStudioPermission('EDIT')
  @Patch(':buildId/plugin')
  updatePlugin(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Param('buildId') buildId: string,
    @Body() dto: UpdatePluginDto,
  ): Promise<BuildInfo> {
    return this.builds.updatePlugin(user, gameId, buildId, dto);
  }
}
