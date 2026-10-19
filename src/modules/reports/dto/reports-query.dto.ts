import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/** `?questionId=q-2&page=2` — os textos de uma pergunta aberta, 10 por página. */
export class AnswersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  questionId?: string;
}

/** "Buscar" e "Filtrar por categoria" da grade de insights. */
export class InsightsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  /** REPORT, HEATMAP ou TRIGGER — o bloco do relatório de onde o insight vem. */
  @IsOptional()
  @IsIn(['REPORT', 'HEATMAP', 'TRIGGER'])
  scope?: 'REPORT' | 'HEATMAP' | 'TRIGGER';
}

export class ExportQueryDto {
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}

export class HeatmapExportQueryDto {
  /** `obj` baixa o Wavefront para a Unity; `json` devolve a grade. */
  @IsOptional()
  @IsIn(['json', 'obj'])
  format?: 'json' | 'obj';

  /** Tamanho da célula, na unidade do mundo do jogo. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  cell?: number;
}

/** Gatilho e mapa escolhidos nos seletores do relatório do plug-in. */
export class PluginReportQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  trigger?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  map?: string;
}
