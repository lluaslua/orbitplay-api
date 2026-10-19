import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { setTotal } from '../../common/pagination/pagination';
import type { HeatmapExport, PluginReport, ReportAnswers, ReportInsight, SessionDetail, TestReport } from '../../contracts';
import { AnswersQueryDto, ExportQueryDto, HeatmapExportQueryDto, InsightsQueryDto, PluginReportQueryDto } from './dto/reports-query.dto';
import { heatmapToObj } from './heatmap';
import { ReportsService } from './reports.service';

/** As telas 11, 12 e 13 do estúdio: relatório, sessão detalhada e plug-in. Exige "Acessar relatórios" no jogo. */
@Roles('STUDIO')
@Controller('reports/:testId')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  report(@CurrentUser() user: RequestUser, @Param('testId') testId: string): Promise<TestReport> {
    return this.reports.getReport(user, testId);
  }

  /** Aba "Todas as Avaliações". */
  @Get('answers')
  answers(@CurrentUser() user: RequestUser, @Param('testId') testId: string, @Query() query: AnswersQueryDto): Promise<ReportAnswers> {
    return this.reports.getAnswers(user, testId, query);
  }

  /** Aba "Insights de IA", paginada. */
  @Get('insights')
  async insights(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Query() query: InsightsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReportInsight[]> {
    const { items, total } = await this.reports.listInsights(user, testId, query);
    setTotal(response, total);
    return items;
  }

  /** Os botões de exportar do relatório: `?format=csv`. */
  @Get('export')
  async export(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Query() _query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const { fileName, csv } = await this.reports.exportCsv(user, testId);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(csv);
  }

  /** `?trigger=&map=`: o gatilho e o mapa dos seletores. Sem eles, os primeiros. */
  @Get('plugin')
  plugin(@CurrentUser() user: RequestUser, @Param('testId') testId: string, @Query() escolha: PluginReportQueryDto): Promise<PluginReport> {
    return this.reports.getPluginReport(user, testId, escolha);
  }

  /** "Baixar mapa .OBJ" / "Exportar para unity" (Figma `427:3376`). */
  @Get('plugin/heatmaps/:map/export')
  async heatmap(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Param('map') map: string,
    @Query() query: HeatmapExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HeatmapExport | string> {
    const heatmap = await this.reports.heatmapExport(user, testId, map, query);
    if (query.format !== 'obj') return heatmap;

    // Cabeçalho HTTP só aceita ASCII: "Fase_01_São Paulo" vira "Fase_01_Sao_Paulo".
    const arquivo = `${map.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_')}.obj`;
    response.setHeader('Content-Type', 'model/obj; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
    return heatmapToObj(heatmap);
  }

  @Get('sessions/:sessionId')
  session(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionDetail> {
    return this.reports.getSessionDetail(user, testId, sessionId);
  }
}
