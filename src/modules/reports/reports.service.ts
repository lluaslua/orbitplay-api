import { Injectable, NotFoundException } from '@nestjs/common';
import type { Insight, Prisma } from '@prisma/client';
import { GameAccessService } from '../../common/access/game-access.service';
import { ARCHETYPE_TONES, TEST_MODEL_LABELS } from '../../common/constants/domain.constants';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { pageArgs } from '../../common/pagination/pagination';
import { clock } from '../../common/utils/dates';
import { formatScore } from '../../common/utils/money';
import { average, ratio, round, sum } from '../../common/utils/numbers';
import type {
  ArchetypeId,
  HeatmapExport,
  InsightTone,
  PluginDetection,
  PluginReport,
  ReportAnswers,
  ReportInsight,
  ReportQuestionSummary,
  ReportStatus,
  SessionDetail,
  TestReport,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { AnswersQueryDto, HeatmapExportQueryDto, InsightsQueryDto, PluginReportQueryDto } from './dto/reports-query.dto';
import { buildHeatmap } from './heatmap';

const SEMANA_MS = 7 * 86_400_000;

type Analise = Pick<SessionDetail, 'classification' | 'evaluation' | 'telemetry'>;

/**
 * Relatórios de um teste (Telas 11, 12 e 13). Tudo é calculado a partir das
 * sessões, dos eventos e dos insights — e só das sessões válidas: recusada
 * não entra na conta (Tela 11, RN-01).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GameAccessService,
  ) {}

  /** Relatório do teste — Figma `326:6452`. */
  async getReport(user: RequestUser, testId: string): Promise<TestReport> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const teste = await this.prisma.playtest.findFirst({
      where: { id: testId },
      include: {
        questions: { orderBy: { position: 'asc' } },
        insights: { orderBy: { createdAt: 'asc' } },
        participations: {
          include: {
            player: { select: { player: { select: { playerType: true, archetype: true } } } },
            session: true,
            events: { where: { type: 'TRIGGER' }, select: { label: true } },
          },
        },
      },
    });
    if (!teste) throw naoEncontrado();

    const rotulos = await this.labels();
    const validas = teste.participations.filter((p) => p.session && p.status !== 'REJECTED');
    const sessoes = validas.map((p) => p.session!);
    const respostas = sessoes.map((s) => s.answers as Record<string, unknown>);

    // Enquanto a análise roda, o relatório diz que está processando (RN-02).
    const status: ReportStatus = !sessoes.length
      ? 'EMPTY'
      : teste.status === 'PROCESSING' || sessoes.some((s) => s.analysis === null)
        ? 'PROCESSING'
        : 'READY';

    const inicio = (teste.startsAt ?? teste.createdAt).getTime();
    const semanas = Math.max(1, Math.ceil((Date.now() - inicio) / SEMANA_MS));
    const evolucao = Array.from({ length: semanas }, (_, i) => ({ label: `Semana ${i + 1}`, tests: 0 }));
    sessoes.forEach((s) => {
      const i = Math.min(semanas - 1, Math.max(0, Math.floor((s.submittedAt.getTime() - inicio) / SEMANA_MS)));
      evolucao[i].tests += 1;
    });

    const indiceEscala = teste.questions.findIndex((q) => q.type === 'LINEAR_SCALE' || q.type === 'RATING');
    const indiceAberta = teste.questions.findIndex((q) => q.type === 'PARAGRAPH' || q.type === 'SHORT_TEXT');
    const escala = teste.questions[indiceEscala];
    const aberta = teste.questions[indiceAberta];

    let scaled: TestReport['ratings']['scaled'] = { title: 'Sem pergunta de escala', distribution: [], average: 0 };
    if (escala) {
      const min = escala.scaleMin ?? 1;
      const max = escala.scaleMax ?? 5;
      const valores = respostas.map((r) => Number(r[escala.id])).filter((v) => Number.isFinite(v) && v >= min && v <= max);
      const distribution = Array.from({ length: max - min + 1 }, () => 0);
      valores.forEach((v) => (distribution[Math.round(v) - min] += 1));
      scaled = { title: `Pergunta ${numero(indiceEscala)} - ${escala.label}`, distribution, average: round(average(valores)) };
    }

    let open: TestReport['ratings']['open'] = { title: 'Sem pergunta aberta', answers: 0, quotes: [] };
    if (aberta) {
      const textos = respostas.map((r) => r[aberta.id]).filter((v): v is string => typeof v === 'string' && !!v.trim());
      open = {
        title: `Pergunta ${numero(indiceAberta)} - ${aberta.label}`,
        answers: textos.length,
        quotes: textos.slice(0, 2).map((t) => `“${t.length > 80 ? `${t.slice(0, 77)}...` : t}”`),
      };
    }

    const achados = teste.insights.filter((i) => i.kind === 'FINDING');
    const sugestoes = teste.insights.filter((i) => i.kind === 'SUGGESTION');
    const recentes = [...validas].sort((a, b) => b.session!.submittedAt.getTime() - a.session!.submittedAt.getTime());

    return {
      testId: teste.id,
      testTitle: teste.title,
      gameId: teste.gameId,
      kind: teste.kind,
      status,
      description: teste.instructions || TEST_MODEL_LABELS[teste.model],
      geral: {
        totalTests: sessoes.length,
        avgSessionSeconds: Math.round(average(sessoes.map((s) => s.durationSeconds))),
        aiScore: round(average(sessoes.map((s) => s.feedbackQuality))),
        testers: new Set(validas.map((p) => p.playerId)).size,
        funFactor: round(average(sessoes.flatMap((s) => (s.overallRating === null ? [] : [s.overallRating])))),
        bugs: sum(sessoes.map((s) => s.bugsFound)),
        retention: round(ratio(sessoes.length, teste.participations.length), 2),
      },
      evolution: evolucao.slice(-5),
      ratings: {
        totalQuestions: teste.questions.length,
        avgSeconds: Math.round(average(sessoes.flatMap((s) => (s.formSeconds === null ? [] : [s.formSeconds])))),
        dropoutRate: round(ratio(teste.participations.filter((p) => !p.session).length, teste.participations.length), 2),
        scaled,
        open,
      },
      telemetry: {
        sessions: validas.filter((p) => p.events.length > 0).length,
        triggers: new Set(validas.flatMap((p) => p.events.map((e) => e.label))).size,
        findings: achados.length,
        suggestions: sugestoes.length,
        findingsList: achados.map((i) => i.title),
        suggestionsList: sugestoes.map((i) => i.title),
      },
      playerTypes: distribuicao(validas.map((p) => p.player.player?.playerType ?? 'CASUAL'), rotulos.tipos),
      archetypes: distribuicao(validas.map((p) => p.player.player?.archetype ?? 'EXPLORER'), rotulos.arquetipos),
      sessions: recentes.slice(0, 20).map((p) => {
        const arquetipo = (p.player.player?.archetype ?? 'EXPLORER') as ArchetypeId;
        return {
          id: p.session!.id,
          date: p.session!.submittedAt.toISOString(),
          archetype: rotulos.arquetipos.get(arquetipo) ?? arquetipo,
          archetypeTone: ARCHETYPE_TONES[arquetipo] ?? 'emerald',
          playerType: rotulos.tipos.get(p.player.player?.playerType ?? 'CASUAL') ?? 'Casual',
          durationSeconds: p.session!.durationSeconds,
          aiScore: p.session!.feedbackQuality,
          plugin: teste.plugin,
        };
      }),
      totalSessions: sessoes.length,
      insights: teste.insights.filter((i) => i.kind === 'INSIGHT' && i.scope === 'REPORT' && !i.sessionId).map(toReportInsight),
    };
  }

  /** Relatório do Orbit Plug-in — Figma `427:3376`. */
  async getPluginReport(user: RequestUser, testId: string, escolha: PluginReportQueryDto = {}): Promise<PluginReport> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const teste = await this.prisma.playtest.findFirst({
      where: { id: testId },
      include: {
        build: true,
        insights: { orderBy: { createdAt: 'asc' } },
        participations: {
          where: { session: { isNot: null }, status: { not: 'REJECTED' } },
          include: { events: { where: { type: { in: ['TRIGGER', 'POSITION'] } }, select: { type: true, label: true, atSecond: true } } },
        },
      },
    });
    if (!teste) throw naoEncontrado();
    if (!teste.plugin) throw new NotFoundException({ message: 'Este teste não usa o Orbit Plug-in.' });

    const gatilhos = ((teste.build?.pluginTriggers ?? []) as unknown as PluginDetection[]).filter((g) => g.enabled);
    const mapas = ((teste.build?.pluginHeatmaps ?? []) as unknown as PluginDetection[]).filter((m) => m.enabled);
    const doBloco = (scope: Insight['scope'], kind: Insight['kind']) =>
      teste.insights.filter((i) => i.scope === scope && i.kind === kind).map(toReportInsight);

    const total = teste.participations.length;
    const selecionado = gatilhos.find((g) => g.name === escolha.trigger) ?? gatilhos[0];
    const ativacoes = teste.participations.map((p) =>
      p.events.filter((e) => e.type === 'TRIGGER' && e.label === selecionado?.name),
    );
    const primeiras = ativacoes.filter((a) => a.length).map((a) => Math.min(...a.map((e) => e.atSecond)));
    const quantas = sum(ativacoes.map((a) => a.length));
    const mapaSelecionado = (mapas.find((m) => m.name === escolha.map) ?? mapas[0])?.name ?? '';
    const imagens = teste.heatmapImages as Record<string, string>;

    return {
      testId: teste.id,
      gameId: teste.gameId,
      testName: teste.title,
      testKind: teste.kind,
      geral: {
        sessions: teste.participations.filter((p) => p.events.length > 0).length,
        heatmaps: mapas.length,
        activeTriggers: gatilhos.length,
        findings: teste.insights.filter((i) => i.scope !== 'REPORT' && i.kind === 'FINDING').length,
        suggestions: teste.insights.filter((i) => i.scope !== 'REPORT' && i.kind === 'SUGGESTION').length,
      },
      heatmap: {
        registered: mapas.length,
        suggestions: doBloco('HEATMAP', 'SUGGESTION').length,
        selected: mapaSelecionado,
        findings: doBloco('HEATMAP', 'FINDING'),
        aiSuggestions: doBloco('HEATMAP', 'SUGGESTION'),
        maps: mapas.map((m) => m.name),
        imageUrl: imagens[mapaSelecionado] ?? '',
      },
      triggers: {
        registered: gatilhos.length,
        suggestions: doBloco('TRIGGER', 'SUGGESTION').length,
        selected: selecionado?.name ?? '',
        findings: doBloco('TRIGGER', 'FINDING'),
        aiSuggestions: doBloco('TRIGGER', 'SUGGESTION'),
        names: gatilhos.map((g) => g.name),
        detail: {
          name: selecionado?.name ?? '-',
          type: selecionado?.varType ?? '-',
          typeTone: tomDoTipo(selecionado?.varType),
          presence: `${Math.round(ratio(primeiras.length, total) * 100)}%`,
          activations: `${quantas} ativações`,
          averageRate: `${formatScore(ratio(quantas, total))} por sessão`,
          averageTime: minutos(average(primeiras)),
        },
      },
      insights: teste.insights.filter((i) => i.kind === 'INSIGHT' && i.scope === 'REPORT' && !i.sessionId).map(toReportInsight),
    };
  }

  /** Detalhamento de uma sessão — Figma `329:9178`. A sessão tem de ser deste teste (Tela 12, RN-01). */
  async getSessionDetail(user: RequestUser, testId: string, sessionId: string): Promise<SessionDetail> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const sessao = await this.prisma.session.findFirst({
      where: { id: sessionId, participation: { playtestId: testId } },
      include: {
        insights: { orderBy: { createdAt: 'asc' } },
        participation: {
          include: {
            playtest: { select: { gameId: true, title: true, kind: true } },
            player: { select: { player: { select: { playerType: true, archetype: true } } } },
          },
        },
      },
    });
    if (!sessao) throw new NotFoundException({ message: 'Sessão não encontrada.' });

    const participacao = sessao.participation;
    const analise = sessao.analysis as unknown as Analise | null;
    const rotulos = await this.labels();
    const arquetipo = (participacao.player.player?.archetype ?? 'EXPLORER') as ArchetypeId;

    return {
      id: sessao.id,
      gameId: participacao.playtest.gameId,
      testName: participacao.playtest.title,
      testKind: participacao.playtest.kind,
      transcript: participacao.transcript as SessionDetail['transcript'],
      // Sem análise ainda: o que se sabe do tester, com os números zerados.
      classification: analise?.classification ?? {
        archetype: rotulos.arquetipos.get(arquetipo) ?? arquetipo,
        archetypeTone: ARCHETYPE_TONES[arquetipo] ?? 'emerald',
        playerType: rotulos.tipos.get(participacao.player.player?.playerType ?? 'CASUAL') ?? 'Casual',
        score: sessao.feedbackQuality,
        funFactor: 0,
        engagement: 0,
        insights: sessao.insights.length,
      },
      evaluation: analise?.evaluation ?? { score: sessao.feedbackQuality, criteria: [] },
      telemetry: analise?.telemetry ?? { triggers: 0, suggestions: 0, total: 0, events: [] },
      insights: sessao.insights.map(toReportInsight),
    };
  }

  /**
   * Aba "Todas as Avaliações" (Figma `326:6452`): o resumo de cada pergunta.
   * Com `?questionId=`, só aquela pergunta, com os textos paginados.
   */
  async getAnswers(user: RequestUser, testId: string, query: AnswersQueryDto): Promise<ReportAnswers> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const teste = await this.prisma.playtest.findUniqueOrThrow({
      where: { id: testId },
      include: {
        questions: { orderBy: { position: 'asc' } },
        participations: { select: { status: true, session: { select: { id: true, answers: true, formSeconds: true, submittedAt: true } } } },
      },
    });
    const validas = teste.participations.filter((p) => p.session && p.status !== 'REJECTED').map((p) => p.session!);
    const recentes = [...validas].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    const { skip, take } = pageArgs({ page: query.page ?? 1, pageSize: query.pageSize ?? 10 });

    const perguntas = teste.questions
      .map((pergunta, indice) => ({ pergunta, indice }))
      .filter(({ pergunta }) => !query.questionId || pergunta.id === query.questionId);
    if (query.questionId && !perguntas.length) throw new NotFoundException({ message: 'Pergunta não encontrada neste teste.' });

    const questions: ReportQuestionSummary[] = perguntas.map(({ pergunta, indice }) => {
      const respostas = recentes.flatMap((s) => {
        const valor = (s.answers as Record<string, unknown>)[pergunta.id];
        return valor === undefined || valor === null || valor === '' ? [] : [{ sessao: s, valor }];
      });
      const resumo: ReportQuestionSummary = {
        id: pergunta.id,
        number: numero(indice),
        label: pergunta.label,
        type: pergunta.type,
        answers: respostas.length,
      };

      if (pergunta.type === 'LINEAR_SCALE' || pergunta.type === 'RATING') {
        const min = pergunta.scaleMin ?? 1;
        const max = pergunta.scaleMax ?? 5;
        const valores = respostas.map((r) => Number(r.valor)).filter((v) => Number.isFinite(v) && v >= min && v <= max);
        resumo.average = round(average(valores));
        resumo.distribution = Array.from({ length: max - min + 1 }, (_, i) => ({
          label: String(min + i),
          count: valores.filter((v) => Math.round(v) === min + i).length,
        }));
      } else if (pergunta.options.length) {
        const marcadas = respostas.flatMap((r) => (Array.isArray(r.valor) ? r.valor.map(String) : [String(r.valor)]));
        // Nas grades a resposta é "Linha: Coluna": cada combinação vira uma opção do resumo.
        const opcoes = pergunta.columns.length
          ? pergunta.options.flatMap((linha) => pergunta.columns.map((coluna) => `${linha}: ${coluna}`))
          : pergunta.options;
        resumo.options = opcoes.map((opcao) => ({ label: opcao, count: marcadas.filter((m) => m === opcao).length }));
      } else {
        const textos = respostas.filter((r) => typeof r.valor === 'string');
        resumo.totalTexts = textos.length;
        resumo.texts = textos.slice(skip, skip + take).map((r) => ({
          sessionId: r.sessao.id,
          text: r.valor as string,
          date: r.sessao.submittedAt.toISOString(),
        }));
      }
      return resumo;
    });

    return {
      testId,
      totalSessions: validas.length,
      avgFormSeconds: Math.round(average(validas.flatMap((s) => (s.formSeconds === null ? [] : [s.formSeconds])))),
      dropoutRate: round(ratio(teste.participations.filter((p) => !p.session).length, teste.participations.length), 2),
      questions,
    };
  }

  /** "Ir para Todos os insights de IA": a grade inteira, com busca e filtro por categoria. */
  async listInsights(user: RequestUser, testId: string, query: InsightsQueryDto): Promise<{ items: ReportInsight[]; total: number }> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const termo = query.search?.trim();
    const where: Prisma.InsightWhereInput = {
      playtestId: testId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(termo
        ? { OR: [{ title: { contains: termo, mode: 'insensitive' } }, { text: { contains: termo, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.insight.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.insight.count({ where }),
    ]);
    return { items: rows.map(toReportInsight), total };
  }

  /** Botões de exportar: uma linha por sessão válida, com as respostas em colunas. */
  async exportCsv(user: RequestUser, testId: string): Promise<{ fileName: string; csv: string }> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const teste = await this.prisma.playtest.findUniqueOrThrow({
      where: { id: testId },
      include: {
        questions: { orderBy: { position: 'asc' } },
        participations: {
          where: { session: { isNot: null }, status: { not: 'REJECTED' } },
          include: { player: { select: { name: true, player: { select: { playerType: true, archetype: true } } } }, session: true },
        },
      },
    });

    const cabecalho = [
      'sessao', 'data', 'tester', 'tipo_de_jogador', 'arquetipo', 'duracao_s', 'formulario_s',
      'nota_ia', 'nota_geral', 'bugs', 'recompensa_centavos', 'status_recompensa',
      ...teste.questions.map((q, i) => `P${numero(i)} ${q.label}`),
    ];
    const linhas = teste.participations
      .sort((a, b) => a.session!.submittedAt.getTime() - b.session!.submittedAt.getTime())
      .map((p) => {
        const s = p.session!;
        const respostas = s.answers as Record<string, unknown>;
        return [
          s.id, s.submittedAt.toISOString(), p.player.name, p.player.player?.playerType ?? '', p.player.player?.archetype ?? '',
          s.durationSeconds, s.formSeconds ?? '', s.feedbackQuality, s.overallRating ?? '', s.bugsFound, p.rewardCents, p.rewardStatus,
          ...teste.questions.map((q) => {
            const valor = respostas[q.id];
            return Array.isArray(valor) ? valor.join('; ') : (valor ?? '');
          }),
        ];
      });

    const csv = [cabecalho, ...linhas].map((linha) => linha.map(celulaCsv).join(',')).join('\r\n');
    // BOM: o Excel em português abre o UTF-8 com acentos certos.
    return { fileName: `relatorio-${testId}.csv`, csv: `\uFEFF${csv}\r\n` };
  }

  /**
   * Mapa de calor de um mapa do plug-in, montado dos eventos POSITION e DEATH
   * enviados pelo jogo. `format=obj` é o "Baixar mapa .OBJ" / "Exportar para unity".
   */
  async heatmapExport(user: RequestUser, testId: string, map: string, query: HeatmapExportQueryDto): Promise<HeatmapExport> {
    await this.access.assertForTest(user, testId, 'VIEW_REPORTS');
    const participacoes = await this.prisma.participation.findMany({
      where: { playtestId: testId, session: { isNot: null }, status: { not: 'REJECTED' } },
      select: { events: { where: { type: { in: ['POSITION', 'DEATH'] }, label: map }, select: { type: true, payload: true } } },
    });
    const eventos = participacoes.flatMap((p) => p.events);
    if (!eventos.length) throw new NotFoundException({ message: `Nenhuma posição registrada no mapa "${map}".` });
    return buildHeatmap(map, eventos, query.cell ?? 1, participacoes.filter((p) => p.events.length).length);
  }

  private async labels() {
    const [tipos, arquetipos] = await Promise.all([
      this.prisma.playerTypeConfig.findMany({ select: { id: true, name: true } }),
      this.prisma.archetypeConfig.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      tipos: new Map(tipos.map((t) => [t.id, t.name])),
      arquetipos: new Map(arquetipos.map((a) => [a.id, a.name])),
    };
  }
}

function toReportInsight(insight: Insight): ReportInsight {
  return {
    id: insight.id,
    title: insight.title,
    category: insight.category,
    categoryTone: insight.categoryTone as InsightTone,
    text: insight.text,
    sessionId: insight.sessionId,
    at: insight.atSecond === null ? null : clock(insight.atSecond),
  };
}

/** Aspas quando precisa, e sem deixar o Excel executar fórmula. */
function celulaCsv(valor: unknown): string {
  let texto = String(valor ?? '');
  if (typeof valor === 'string' && /^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Fatias de rosca, na ordem da maior para a menor. */
function distribuicao(ids: string[], nomes: Map<string, string>): { label: string; value: number }[] {
  const contagem = new Map<string, number>();
  ids.forEach((id) => contagem.set(id, (contagem.get(id) ?? 0) + 1));
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({ label: nomes.get(id) ?? id, value }));
}

function tomDoTipo(varType: string | undefined): InsightTone {
  if (!varType) return 'jade';
  if (varType.startsWith('Vector3')) return 'amethyst';
  if (varType.startsWith('Time')) return 'sapphire';
  return 'jade';
}

/** "05m42s". */
function minutos(segundos: number): string {
  const total = Math.round(segundos);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}m${String(total % 60).padStart(2, '0')}s`;
}

function numero(indice: number): string {
  return String(indice + 1).padStart(2, '0');
}

function naoEncontrado() {
  return new NotFoundException({ message: 'Relatório não encontrado.' });
}
