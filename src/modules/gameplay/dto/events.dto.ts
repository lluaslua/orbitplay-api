import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SESSION_EVENT_TYPES } from '../../../common/constants/domain.constants';
import type { SessionEventInput, SessionEventType } from '../../../contracts';

export class SessionEventDto implements SessionEventInput {
  @IsInt()
  @Min(0)
  atSecond: number;

  @IsIn(SESSION_EVENT_TYPES)
  type: SessionEventType;

  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detail?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class EventsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SessionEventDto)
  events: SessionEventDto[];
}
