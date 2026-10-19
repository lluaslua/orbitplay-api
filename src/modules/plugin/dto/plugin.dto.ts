import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEATH_CAUSES, TRIGGER_LOGICS } from '../../../common/constants/domain.constants';
import type {
  DeathCauseTracking,
  PluginMapConfig,
  PluginTriggerConfig,
  TelemetryEventInput,
  TriggerLogic,
} from '../../../contracts';

export class CreatePluginKeyDto {
  /** Para reconhecer o código depois: "Máquina do Hideo", "CI". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class DeathConditionDto {
  @IsString() @MaxLength(120) script: string;
  @IsString() @MaxLength(120) variable: string;
  @IsIn(['<=', '<', '==', '>=', '>', '!=']) operator: string;
  @IsNumber() value: number;
}

export class PluginMapDto implements PluginMapConfig {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @MaxLength(120) targetObject: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeathConditionDto)
  deathCondition?: DeathConditionDto;

  @IsArray()
  @IsIn(DEATH_CAUSES, { each: true })
  deathCauseTracking: DeathCauseTracking[];

  @IsOptional()
  @IsIn([2, 3])
  dimensions?: 2 | 3;
}

export class PluginTriggerDto implements PluginTriggerConfig {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @MaxLength(160) target: string;
  @IsString() @MaxLength(60) valueType: string;
  @IsIn(TRIGGER_LOGICS) logic: TriggerLogic;
  @IsOptional() @IsNumber() threshold?: number;
  @IsOptional() @IsBoolean() autoScouted?: boolean;
}

/** O que o Inspector da Unity manda ao salvar (Figma `423:3000`). */
export class PluginConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sdkVersion?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PluginMapDto)
  maps: PluginMapDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PluginTriggerDto)
  triggers: PluginTriggerDto[];
}

export class TelemetryEventDto implements TelemetryEventInput {
  @IsInt() @Min(0) atSecond: number;
  @IsIn(['TRIGGER', 'POSITION', 'DEATH']) type: 'TRIGGER' | 'POSITION' | 'DEATH';
  @IsString() @IsNotEmpty() @MaxLength(120) label: string;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsNumber() x?: number;
  @IsOptional() @IsNumber() y?: number;
  @IsOptional() @IsNumber() z?: number;
  @IsOptional() @IsIn(DEATH_CAUSES) cause?: DeathCauseTracking;
  @IsOptional() @IsString() @MaxLength(500) detail?: string;
}

export class TelemetryBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TelemetryEventDto)
  events: TelemetryEventDto[];
}
