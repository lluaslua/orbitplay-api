import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { GameSpecs, GameStatus } from '../../../contracts';
import { GameFieldsDto } from './create-game.dto';

export class GameSpecsDto implements Partial<GameSpecs> {
  @IsOptional() @IsString() @MaxLength(120) minOs?: string;
  @IsOptional() @IsString() @MaxLength(120) minCpu?: string;
  @IsOptional() @IsString() @MaxLength(60) minRam?: string;
  @IsOptional() @IsString() @MaxLength(120) minGpu?: string;
  @IsOptional() @IsString() @MaxLength(60) diskSpace?: string;
  @IsOptional() @IsBoolean() requiresController?: boolean;
  @IsOptional() @IsBoolean() requiresMicrophone?: boolean;
  @IsOptional() @IsBoolean() requiresWebcam?: boolean;
}

/** DRAFT não se escolhe: é o estado de quem ainda não publicou teste. */
const STATUS_EDITAVEIS: GameStatus[] = ['ACTIVE', 'PAUSED', 'ARCHIVED'];

export class UpdateGameDto extends GameFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome ao jogo.' })
  @MaxLength(120)
  name?: string;

  @IsOptional() @IsIn(STATUS_EDITAVEIS) status?: GameStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => GameSpecsDto)
  specs?: GameSpecsDto;
}
