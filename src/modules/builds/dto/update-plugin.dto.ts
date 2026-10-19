import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PLATFORMS } from '../../../common/constants/domain.constants';
import type { Platform, UpdateBuildPayload, UpdatePluginPayload } from '../../../contracts';

export class PluginItemDto {
  @IsString()
  id: string;

  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @IsString({ each: true })
  selectedMetrics: string[];

  /** Só nos tipos com "Quantidade controle" — o service confere. */
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number | null;
}

export class UpdatePluginDto implements UpdatePluginPayload {
  /** `false` é o "Remover Plug-in": desliga sem apagar o que foi detectado. */
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PluginItemDto)
  items?: PluginItemDto[];
}

export class UpdateBuildDto implements UpdateBuildPayload {
  @IsArray()
  @ArrayNotEmpty({ message: 'Escolha pelo menos um sistema.' })
  @IsIn(PLATFORMS, { each: true })
  platforms: Platform[];
}
