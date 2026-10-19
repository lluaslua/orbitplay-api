/**
 * Seed de desenvolvimento.
 *
 * As contas de demonstração do app e o conteúdo das fixtures do mock
 * (orbitplay-app/src/mocks/fixtures, copiadas em prisma/seed-data), convertidos
 * para o modelo real. Os números agregados — dashboards, relatórios — não vêm
 * daqui: a API calcula a partir destes dados.
 *
 * Apaga tudo antes de inserir. Só para banco local. Senha de todas as contas: 123456.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DEFAULT_APP_DOWNLOADS,
  DEFAULT_PLUGIN_INFO,
  DEFAULT_REWARD_BONUSES,
  DEFAULT_TIER_RULES,
  DEFAULT_TUTORIAL,
  DEFAULT_XP_RULES,
} from '../src/common/settings/settings.defaults';

const prisma = new PrismaClient();

function load<T>(arquivo: string): T {
  return JSON.parse(readFileSync(join(__dirname, 'seed-data', arquivo), 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// Formato das fixtures (só o que o seed usa)
// ---------------------------------------------------------------------------

interface FxGame {
  id: string;
  studioId: string;
  studioName: string;
  name: string;
  shortDescription: string;
  description: string;
  bannerUrl: string;
  thumbnailUrl: string;
  status: 'ACTIVE' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';
  genres: string[];
  platforms: string[];
  buildVersion: string;
  maxRewardCents: number;
  estimatedMinutes: number;
  stats: { totalPlayers: number };
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
  specs: Record<string, unknown>;
}

interface FxQuestion {
  id: string;
  type: string;
  label: string;
  helperText?: string;
  required: boolean;
  options?: string[];
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

interface FxBudget {
  slots: number;
  untilDisabled: boolean;
  basePriceCents: number;
  audienceCents: number;
  boostCents: number;
  pricePerTestCents: number;
  totalCents: number;
  rewardPerSessionCents: number;
  durationDays: number;
}

interface FxTest {
  id: string;
  gameId: string;
  title: string;
  model: 'TELEMETRY' | 'FREE_EXPLORATION' | 'AB_TEST' | 'AB_IMAGES';
  status: 'DRAFT' | 'ACTIVE' | 'FULL' | 'PROCESSING' | 'FINISHED' | 'PAUSED';
  instructions: string;
  requiresRecording: boolean;
  requiresMicrophone: boolean;
  requiresWebcam: boolean;
  questions: FxQuestion[];
  audience: { locations: string[]; playerType: string; archetype: string; minAge: number; maxAge: number };
  budget: FxBudget;
  currentParticipants: number;
  estimatedMinutes: number;
  buildFileName: string;
  buildSizeMb: number;
  createdAt: string;
  expiresAt: string;
  plugin: boolean;
  kind: string;
}

interface FxSession {
  id: string;
  testId: string;
  playerId: string;
  playerName: string;
  durationSeconds: number;
  feedbackQuality: number;
  bugsFound: number;
  overallRating: number;
  xpEarned: number;
  rewardCents: number;
  rewardStatus: 'PENDING' | 'VALIDATED' | 'PAID' | 'REJECTED';
  recordedAt: string;
  transcript: string;
  timeline: { id: string; atSecond: number; type: string; label: string; detail?: string }[];
  insights: { id: string; title: string; description: string; severity: string; category: string; confidence: number }[];
  answers: { question: string; answer: string }[];
}

interface FxCard {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  categoryTone?: string;
  text?: string;
  locked?: boolean;
}

interface FxPlayers {
  accounts: { user: { id: string; name: string; email: string; createdAt: string; studio?: { organization: string; cnpj: string; website: string; balance: number }; player?: Record<string, number | string> } }[];
  achievements: { id: string; name: string; description: string; icon: string; xp: number; unlockedAt?: string }[];
  participations: { id: string; testId: string; status: string; rewardCents: number; rewardStatus: string; xpEarned: number; startedAt: string; finishedAt?: string; durationSeconds?: number }[];
  gameTests: Record<string, { id: string; name: string; kind: string; estimatedMinutes: number; slotsTaken: number; slotsTotal: number; progress: number; rewardCents: number; boosted?: boolean; action: string }[]>;
  gameMyTests: { id: string; name: string; kind: string; estimatedMinutes: number; slotsTaken: number; slotsTotal: number; rewardCents: number; status: string }[];
  gameAchievements: FxCard[];
  sessionReview: { transcript: { at: string; text: string }[] };
  sessionOutcome: Record<string, unknown>;
}

interface FxReports {
  testReport: { insights: FxCard[] };
  sessionDetail: { transcript: unknown[]; classification: unknown; evaluation: unknown; telemetry: unknown };
  pluginReport: {
    heatmap: { findings: FxCard[]; aiSuggestions: FxCard[] };
    triggers: { findings: FxCard[]; aiSuggestions: FxCard[] };
  };
}

interface FxCommunity {
  channels: { id: string; name: string }[];
  members: { userId: string; name: string; avatarUrl: string }[];
  messages: Record<string, { id: string; channelId: string; authorId: string; text: string; sentAt: string }[]>;
}

// ---------------------------------------------------------------------------
// Tabelas de preço — o conteúdo exato das constantes do app (utils/constants.ts)
// ---------------------------------------------------------------------------

const MODELOS: Prisma.TestModelConfigCreateManyInput[] = [
  {
    id: 'TELEMETRY',
    position: 0,
    name: 'Exploração livre + Telemetria',
    tagline: 'Observe o jogador sem interferir. Entenda o comportamento real.',
    description:
      'Nesse modelo, o jogador explora o jogo normalmente, enquanto o estúdio define previamente quais gatilhos, eventos e comportamentos serão medidos. Esses gatilhos são integrados diretamente na build do jogo, permitindo que o plugin de telemetria da OrbitPlay colete dados precisos e relevantes da sessão, revelando como o jogo é realmente jogado, e não apenas o que o jogador relata.',
    deliversTitle: 'O que a telemetria captura:',
    delivers: [
      'Caminhos mais percorridos no mapa.',
      'Tempo de permanência por área ou fase.',
      'Eventos acionados (combate, interação, falha, abandono).',
      'Pontos de confusão, repetição ou desistência.',
      'Ritmo de progressão do jogador.',
    ],
    pricePerTestCents: 69,
    recommended: true,
    requiresPlugin: true,
    icon: 'telemetry',
  },
  {
    id: 'FREE_EXPLORATION',
    position: 1,
    name: 'Exploração livre',
    tagline: 'Ideal para descobertas espontâneas.',
    description:
      'O jogador explora a demo livremente, por tempo ou por fase, sem coleta automática de dados. Os insights vêm da gravação da gameplay e do feedback final, focando nas impressões reais, sensações e opiniões do player.',
    deliversTitle: 'O que entrega:',
    delivers: [
      'Gameplay livre com gravação e transcrição automática.',
      'Insights de IA sobre comportamento, frustração, diversão e engajamento.',
      'Linha de humor/emocional ao longo do tempo ou por fase.',
      'Análise aplicável a jogos 2D ou 3D, sem limitação de gênero.',
      'Pesquisa pós-teste personalizada pelo seu estúdio, focada nos objetivos do projeto.',
    ],
    pricePerTestCents: 59,
    icon: 'free',
  },
  {
    id: 'AB_TEST',
    position: 2,
    name: 'Teste A/B',
    tagline: 'Ideal para comparar versões.',
    description:
      'Nesse modelo, jogadores testam duas versões jogáveis do mesmo jogo (Build A e Build B). A plataforma compara automaticamente métricas de engajamento, dificuldade, retenção e feedback qualitativo, permitindo identificar qual versão entrega a melhor experiência antes do lançamento.',
    deliversTitle: 'O que entrega:',
    delivers: [
      'Comparação direta entre duas builds ou variações',
      'Métricas estatísticas claras',
      'Recomendação automática da melhor versão',
    ],
    pricePerTestCents: 39,
    icon: 'ab',
  },
  {
    id: 'AB_IMAGES',
    position: 3,
    name: 'Teste A/B de imagens',
    tagline: 'Teste rapidamente qual visual gera mais impacto e clareza.',
    description:
      'Jogadores avaliam duas ou mais variações visuais (ex: UI, HUD, menus, personagens ou telas de loja) sem precisar jogar. A IA analisa preferências, clareza, impacto visual e intenção do jogador, ajudando o estúdio a decidir rapidamente qual versão funciona melhor.',
    deliversTitle: 'O que entrega:',
    delivers: [
      'Comparação direta entre duas ou mais variações visuais.',
      'Métricas de preferência, clareza e impacto visual.',
      'Insights de IA sobre atenção, compreensão e decisão do jogador.',
      'Resultados rápidos, sem necessidade de build jogável.',
      'Pesquisa final personalizada pelo estúdio para validar a escolha.',
    ],
    pricePerTestCents: 19,
    icon: 'ab-images',
  },
];

const TIPOS = [
  { id: 'ALL', name: 'Todos', tier: '$$', extraCents: 10, description: 'Combina diferentes perfis e estilos de jogo. Ideal para obter uma visão ampla e equilibrada da experiência geral do jogo.' },
  { id: 'CASUAL', name: 'Casual', tier: '$', extraCents: 0, description: 'Avalia diversão, clareza e primeira impressão do jogo. Ideal para validar se o jogo é intuitivo para o público geral.' },
  { id: 'EXPERIENT', name: 'Experiente', tier: '$$', extraCents: 10, description: 'Analisa dificuldade, balanceamento e compara com outros jogos do gênero.' },
  { id: 'TRAINED', name: 'Tester treinado', tier: '$$$', extraCents: 15, description: 'Entrega feedback estruturado, claro e acionável para decisões de design e UX.' },
  { id: 'QA', name: 'QA Profissionais', tier: '$$$$', extraCents: 25, description: 'Identifica bugs, glitches, problemas de performance e acessibilidade, com passos de reprodução.' },
];

const ARQUETIPOS = [
  { id: 'ALL', name: 'Todos', description: 'Inclui diferentes estilos de jogo para revelar padrões variados de comportamento, decisões e engajamento ao longo da experiência.' },
  { id: 'CONQUEROR', name: 'Conquistador', description: 'Focado em progresso, metas e recompensas. Gera insights sobre pacing, economia e sistemas de progressão.' },
  { id: 'EXPLORER', name: 'Explorador', description: 'Curioso por natureza. Revela problemas de level design, orientação e áreas pouco exploradas.' },
  { id: 'SOCIALIZER', name: 'Socializador', description: 'Atento à narrativa e interações. Avalia diálogos, personagens e engajamento emocional.' },
  { id: 'KILLER', name: 'Assassino', description: 'Competitivo e orientado à performance. Detecta problemas de balanceamento e frustração em desafios e PvP.' },
];

const TOM_ARQUETIPO: Record<string, string> = { ALL: 'amethyst', CONQUEROR: 'amber', EXPLORER: 'emerald', SOCIALIZER: 'sapphire', KILLER: 'ruby' };
const TOM_CATEGORIA: Record<string, string> = { BALANCE: 'amber', UX: 'sapphire', PERFORMANCE: 'ruby', BUG: 'ruby', ENGAGEMENT: 'emerald' };

/** O que a etapa 3 do app mostra como detectado (PLUGIN_TRIGGERS / PLUGIN_HEATMAPS). */
const GATILHOS = [
  { id: 'tr-1', varType: 'Int', varTone: 'emerald', name: 'BOSS01_Defeat', kind: 'Contador', amountEditable: true, metrics: ['Média', 'Total', 'Tempo médio'] },
  { id: 'tr-2', varType: 'Time.DeltaTime', varTone: 'sapphire', name: 'Tempo_Fase02', kind: 'Contador tempo', amountEditable: true, metrics: ['Média', 'Máximo/mínimo'] },
  { id: 'tr-3', varType: 'Int', varTone: 'emerald', name: 'Menu_Loja', kind: 'Contador UI', amountEditable: true, metrics: ['Total', 'Tempo médio entre contagem'] },
  { id: 'tr-4', varType: 'Vector3.position', varTone: 'amethyst', name: 'Movimentação', kind: 'Vector3', amountEditable: false, metrics: ['Média', 'Ângulo médio'] },
  { id: 'tr-5', varType: 'Int', varTone: 'emerald', name: 'ESPECIAL_UNO', kind: 'Contador Input', amountEditable: true, metrics: ['Total', 'Tempo médio entre contagem'] },
].map((item) => ({ ...item, enabled: true, selectedMetrics: item.metrics, amount: null }));

const MAPAS = [
  { id: 'hm-1', varType: 'Vector3.position', varTone: 'amethyst', name: 'Fase_01_São Paulo', kind: 'Vector3', amountEditable: false, metrics: ['Média', 'Ângulo médio'] },
  { id: 'hm-2', varType: 'Int', varTone: 'emerald', name: 'BOSS01_Defeat', kind: 'Contador', amountEditable: true, metrics: ['Média', 'Total', 'Tempo médio'] },
].map((item) => ({ ...item, enabled: true, selectedMetrics: item.metrics, amount: null }));

/** Os gêneros das fixtures estão em português; o cadastro novo usa a lista do Figma (`1183:7598`). */
const GENERO: Record<string, string> = {
  Ação: 'Action',
  Aventura: 'Adventure',
  Corrida: 'Racing',
  Estratégia: 'Strategy',
  Simulação: 'Simulation',
  Esporte: 'Sports',
  Terror: 'Horror',
};

/** Um sub-gênero (`1183:7695`) por gênero, para os jogos das fixtures terem o cadastro completo. */
const SUB_GENERO: Record<string, string> = {
  Action: 'Hack and Slash',
  Adventure: 'Narrative Adventure',
  Racing: 'Arcade Racing',
  Strategy: 'Turn-Based Strategy',
  Puzzle: 'Puzzle Platformer',
  RPG: 'Action RPG',
  Sports: 'Competitive',
  Horror: 'Survival Horror',
  Casual: 'Casual',
  Simulation: 'Management Sim',
};

/** Código de acesso do plug-in do Racha de Rua — o que se digita no "Validar código de acesso" da Unity. */
export const CODIGO_PLUGIN_DEMO = 'opk_demo_racha_de_rua_0001';

/** O Inspector do Figma (`423:3000`): o mapa Player_Fase_01 e os gatilhos da etapa 3.1. */
const CONFIG_PLUGIN = {
  maps: [
    {
      name: 'Fase_01_São Paulo',
      targetObject: 'Player (Transform)',
      deathCondition: { script: 'playerController.cs', variable: 'int_vida_player', operator: '<=', value: 0 },
      deathCauseTracking: ['COLLISION', 'CODE', 'ERROR'],
      dimensions: 3,
    },
  ],
  triggers: [
    { name: 'BOSS01_Defeat', target: 'BossController.defeated', valueType: 'Int', logic: 'ON_CHANGE' },
    { name: 'Tempo_Fase02', target: 'LevelTimer.fase02', valueType: 'Time.DeltaTime', logic: 'CUMULATIVE' },
    { name: 'Menu_Loja', target: 'ShopMenu.open', valueType: 'Int', logic: 'ON_CHANGE' },
    { name: 'ESPECIAL_UNO', target: 'Input.especial', valueType: 'Int', logic: 'ON_CHANGE' },
    { name: 'Especial_Boost', target: '()Especial_01', valueType: 'Int', logic: 'THRESHOLD', threshold: 1, autoScouted: true },
  ],
};

// ---------------------------------------------------------------------------

const agora = Date.now();
const PRAZO_FIGMA = (27 * 60 + 32) * 60_000; // "Termina em 27h 32m"
const emBreve = () => new Date(agora + PRAZO_FIGMA);
const diasAtras = (dias: number) => new Date(agora - dias * 86_400_000);
const slug = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const json = (valor: unknown) => valor as Prisma.InputJsonValue;

/**
 * O formulário da tela "Avaliação do jogo" (Figma `235:7874`), como um estúdio
 * montaria na etapa 2. O bloco "Você encontrou algum problema?" é fixo no app —
 * ele vira os bugs reportados — e por isso não entra aqui.
 */
const PERGUNTAS_PADRAO: FxQuestion[] = [
  { id: 'q-1', type: 'LINEAR_SCALE', label: 'Avaliação geral', required: true, scaleMin: 1, scaleMax: 5 },
  { id: 'q-2', type: 'LINEAR_SCALE', label: 'Quão divertido foi?', required: false, scaleMin: 1, scaleMax: 10 },
  { id: 'q-3', type: 'LINEAR_SCALE', label: 'Nível do desafio', required: false, scaleMin: 1, scaleMax: 10, scaleMinLabel: 'Fácil', scaleMaxLabel: 'Difícil' },
  { id: 'q-4', type: 'LINEAR_SCALE', label: 'Por quanto tempo você jogaria novamente?', required: false, scaleMin: 1, scaleMax: 10, scaleMinLabel: 'Pouco tempo', scaleMaxLabel: 'Muito tempo' },
  { id: 'q-5', type: 'MULTIPLE_CHOICE', label: 'Você recomendaria esse jogo a um amigo?', required: false, options: ['Sim', 'Não', 'Talvez'] },
  { id: 'q-6', type: 'SHORT_TEXT', label: 'Qual foi o momento mais divertido do teste?', required: false },
  { id: 'q-7', type: 'SHORT_TEXT', label: 'O que mais te incomodou durante o jogo?', required: false },
  { id: 'q-8', type: 'SHORT_TEXT', label: 'Deixe o seu feedback', required: false },
];

/**
 * O formulário do `test-006`: os quatro tipos que o Novo teste oferece
 * (Figma `1192:11096`) — escala linear com e sem marcadores, escolha, múltipla
 * escolha e resposta curta —, na ordem da tela "Avaliação do jogo" (`235:7874`).
 */
const PERGUNTAS_COMPLETAS: FxQuestion[] = [
  ...PERGUNTAS_PADRAO.slice(0, 5),
  { id: 'q-9', type: 'CHECKBOXES', label: 'Quais modos você experimentou?', required: false, options: ['Corrida rápida', 'Campeonato', 'Contra o relógio', 'Multijogador'] },
  ...PERGUNTAS_PADRAO.slice(5),
];

function questionsOf(perguntas: FxQuestion[]) {
  return perguntas.map((q, position) => ({
    id: q.id,
    position,
    type: q.type,
    label: q.label,
    helperText: q.helperText,
    required: q.required,
    options: q.options ?? [],
    columns: q.columns ?? [],
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleMinLabel: q.scaleMinLabel,
    scaleMaxLabel: q.scaleMaxLabel,
  }));
}

/** As respostas das fixtures vêm como texto, na ordem das perguntas. */
function answersOf(perguntas: FxQuestion[], respostas: { answer: string }[]) {
  const saida: Record<string, string | number | string[]> = {};
  perguntas.forEach((pergunta, i) => {
    const resposta = respostas[i]?.answer;
    if (resposta === undefined) return;
    if (pergunta.type === 'LINEAR_SCALE' || pergunta.type === 'RATING') {
      const numero = parseInt(resposta, 10);
      if (!Number.isNaN(numero)) saida[pergunta.id] = numero;
    } else if (pergunta.type === 'CHECKBOXES') {
      saida[pergunta.id] = resposta.split(', ');
    } else {
      saida[pergunta.id] = resposta;
    }
  });
  return saida;
}

function budgetOf(modelo: string, slots: number, reward: number, boost = false, perfilCents = 10) {
  const base = MODELOS.find((m) => m.id === modelo)!.pricePerTestCents;
  const boostCents = boost ? 15 : 0;
  const pricePerTestCents = base + perfilCents + boostCents;
  return {
    slots,
    untilDisabled: false,
    basePriceCents: base,
    audienceCents: perfilCents,
    boostCents,
    pricePerTestCents,
    totalCents: pricePerTestCents * slots,
    rewardPerSessionCents: reward,
    durationDays: 14,
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('O seed apaga o banco — não rode em produção.');

  const games = load<FxGame[]>('games.json');
  const tests = load<FxTest[]>('tests.json');
  const sessions = load<FxSession[]>('sessions.json');
  const players = load<FxPlayers>('players.json');
  const reports = load<FxReports>('reports.json');
  const community = load<FxCommunity>('community.json');
  const senha = await hash('123456', 10);

  // Limpa na ordem das dependências.
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.retestInvite.deleteMany(),
    prisma.gameAccess.deleteMany(),
    prisma.studioGroupMember.deleteMany(),
    prisma.studioGroup.deleteMany(),
    prisma.pluginKey.deleteMany(),
    prisma.gamePluginConfig.deleteMany(),
    prisma.idempotencyRecord.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.messageReaction.deleteMany(),
    prisma.chatMessage.deleteMany(),
    prisma.communityChannel.deleteMany(),
    prisma.ledgerEntry.deleteMany(),
    prisma.withdrawal.deleteMany(),
    prisma.playerGameAchievement.deleteMany(),
    prisma.gameAchievement.deleteMany(),
    prisma.playerAchievement.deleteMany(),
    prisma.achievement.deleteMany(),
    prisma.insight.deleteMany(),
    prisma.sessionEvent.deleteMany(),
    prisma.session.deleteMany(),
    prisma.participation.deleteMany(),
    prisma.order.deleteMany(),
    prisma.testQuestion.deleteMany(),
    prisma.playtest.deleteMany(),
    prisma.build.deleteMany(),
    prisma.game.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.playerProfile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.studio.deleteMany(),
    prisma.testModelConfig.deleteMany(),
    prisma.playerTypeConfig.deleteMany(),
    prisma.archetypeConfig.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  // --- Tabelas de preço ------------------------------------------------------
  await prisma.testModelConfig.createMany({ data: MODELOS });
  await prisma.playerTypeConfig.createMany({ data: TIPOS.map((t, position) => ({ ...t, position })) });
  await prisma.archetypeConfig.createMany({ data: ARQUETIPOS.map((a, position) => ({ ...a, position })) });
  await prisma.setting.createMany({
    data: [
      { key: 'boostCents', value: 15 },
      { key: 'tierRules', value: json(DEFAULT_TIER_RULES) },
      { key: 'rewardBonuses', value: json(DEFAULT_REWARD_BONUSES) },
      { key: 'xpRules', value: json(DEFAULT_XP_RULES) },
      { key: 'pluginInfo', value: json(DEFAULT_PLUGIN_INFO) },
      { key: 'appDownloads', value: json(DEFAULT_APP_DOWNLOADS) },
      { key: 'tutorial', value: json(DEFAULT_TUTORIAL) },
    ],
  });

  // --- Estúdios --------------------------------------------------------------
  const contaEstudio = players.accounts.find((a) => a.user.studio)!.user;
  await prisma.studio.create({
    data: {
      id: 'studio-001',
      name: contaEstudio.studio!.organization,
      cnpj: contaEstudio.studio!.cnpj,
      website: contaEstudio.studio!.website,
      balanceCents: contaEstudio.studio!.balance,
    },
  });
  // Os jogos de terceiros dividem o "studio-ext" das fixtures; aqui cada um tem o seu.
  const estudioDe = (game: FxGame) => (game.studioId === 'studio-001' ? 'studio-001' : `studio-${slug(game.studioName)}`);
  const externos = [...new Map(games.filter((g) => g.studioId !== 'studio-001').map((g) => [estudioDe(g), g.studioName])).entries()];
  await prisma.studio.createMany({ data: externos.map(([id, name]) => ({ id, name })) });

  // --- Arquivos das builds ----------------------------------------------------
  // Toda build aberta tem arquivo de verdade em storage/private (as amostras de
  // samples/), para o tester baixar no tutorial. Uploads de rodadas anteriores saem.
  const pastaBuilds = join(resolve(__dirname, '..', process.env.STORAGE_DIR ?? 'storage'), 'private', 'builds');
  await rm(pastaBuilds, { recursive: true, force: true });
  const AMOSTRAS = { exe: 'RachaDeRua-1.3.0-sem-plugin.exe', plugin: 'RachaDeRua-1.3.0-com-plugin.unity' } as const;
  const buildComArquivo = async (
    data: Omit<Prisma.BuildUncheckedCreateInput, 'fileName' | 'sizeMb' | 'storageKey' | 'sha256'>,
    amostra: keyof typeof AMOSTRAS,
  ) => {
    const fileName = AMOSTRAS[amostra];
    const bytes = await readFile(join(__dirname, '..', 'samples', fileName));
    const build = await prisma.build.create({
      data: {
        ...data,
        fileName,
        sizeMb: Math.round((bytes.length / (1024 * 1024)) * 100) / 100,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
    await mkdir(join(pastaBuilds, build.id), { recursive: true });
    await writeFile(join(pastaBuilds, build.id, fileName), bytes);
    return prisma.build.update({ where: { id: build.id }, data: { storageKey: `builds/${build.id}/${fileName}` } });
  };

  // --- Contas ----------------------------------------------------------------
  const avatar = (userId: string) => community.members.find((m) => m.userId === userId)?.avatarUrl;
  await prisma.user.create({
    data: { id: 'owner-001', name: 'Owner OrbitPlay', email: 'owner@orbitplay.com', passwordHash: senha, role: 'OWNER' },
  });
  await prisma.user.create({
    data: {
      id: contaEstudio.id,
      name: 'Gusmão',
      email: contaEstudio.email,
      passwordHash: senha,
      role: 'STUDIO',
      studioId: 'studio-001',
      studioPermission: 'MANAGE',
      avatarUrl: avatar(contaEstudio.id),
      lastLoginAt: new Date(),
      createdAt: new Date(contaEstudio.createdAt),
    },
  });

  const contaJogador = players.accounts.find((a) => a.user.player)!.user;
  const p = contaJogador.player!;
  await prisma.user.create({
    data: {
      id: contaJogador.id,
      name: contaJogador.name,
      email: contaJogador.email,
      passwordHash: senha,
      role: 'PLAYER',
      avatarUrl: avatar(contaJogador.id),
      createdAt: new Date(contaJogador.createdAt),
      player: {
        create: {
          level: Number(p.level),
          xp: Number(p.xp),
          xpToNextLevel: Number(p.xpToNextLevel),
          rating: Number(p.rating),
          tier: String(p.tier),
          completedSessions: Number(p.completedSessions),
          achievementsCount: Number(p.achievementsCount),
          secondsPlayed: Number(p.hoursPlayed) * 3600,
          location: 'BRASIL',
          birthDate: new Date('2000-05-10'),
          playerType: 'CASUAL',
          archetype: 'EXPLORER',
          tutorialSeenAt: diasAtras(30),
        },
      },
    },
  });

  // Os testers das sessões e do chat não têm conta nas fixtures.
  const testers = [
    { id: 'player-002', name: 'Carlos Mendes', playerType: 'EXPERIENT', archetype: 'CONQUEROR', tier: 'VETERANO' },
    { id: 'player-003', name: 'Beatriz Rocha', playerType: 'CASUAL', archetype: 'EXPLORER', tier: 'NOVATO' },
    { id: 'player-006', name: 'Rafael Souza', playerType: 'CASUAL', archetype: 'KILLER', tier: 'VETERANO' },
    { id: 'player-007', name: 'Juliana Castro', playerType: 'CASUAL', archetype: 'SOCIALIZER', tier: 'NOVATO' },
    { id: 'qa-cellbitos', name: 'Cellbitos', playerType: 'QA', archetype: 'EXPLORER', tier: 'QA' },
    { id: 'qa-jones', name: 'Jones', playerType: 'QA', archetype: 'KILLER', tier: 'QA' },
  ];
  for (const tester of testers) {
    await prisma.user.create({
      data: {
        id: tester.id,
        name: tester.name,
        email: `${slug(tester.name)}@teste.orbitplay.com`,
        passwordHash: senha,
        role: 'PLAYER',
        avatarUrl: avatar(tester.id),
        player: {
          create: {
            level: 6,
            xp: 900,
            xpToNextLevel: 1500,
            tier: tester.tier,
            location: 'BRASIL',
            birthDate: new Date('1996-03-15'),
            playerType: tester.playerType,
            archetype: tester.archetype,
          },
        },
      },
    });
  }
  const perfilDe = new Map([
    [contaJogador.id, { playerType: 'CASUAL', archetype: 'EXPLORER' }],
    ...testers.map((t) => [t.id, { playerType: t.playerType, archetype: t.archetype }] as const),
  ]);

  // --- Jogos -----------------------------------------------------------------
  for (const game of games) {
    const generos = [...new Set(game.genres.map((g) => GENERO[g] ?? g))];
    // O Racha de Rua é o jogo do estúdio de demonstração: ganha o cadastro do "Novo jogo" inteiro.
    const demo = game.id === 'game-001';
    await prisma.game.create({
      data: {
        id: game.id,
        studioId: estudioDe(game),
        name: game.name,
        tagline: demo ? 'Rachas de rua pelas avenidas de São Paulo.' : game.shortDescription,
        shortDescription: game.shortDescription,
        description: game.description,
        bannerUrl: game.bannerUrl,
        thumbnailUrl: game.thumbnailUrl,
        logoUrl: game.thumbnailUrl,
        trailerUrl: demo ? 'https://www.youtube.com/watch?v=racha-de-rua-trailer' : null,
        status: game.status,
        genres: generos,
        subGenres: generos.flatMap((g) => (SUB_GENERO[g] ? [SUB_GENERO[g]] : [])),
        gameModes: demo ? ['SINGLE_PLAYER', 'MULTIPLAYER', 'PVP'] : ['SINGLE_PLAYER'],
        engine: 'UNITY',
        developmentStage: demo ? 'ALPHA' : game.id === 'game-101' ? 'EARLY_ACCESS' : 'BETA',
        ageRating: generos.includes('Horror') ? '14' : 'L',
        languages: demo ? ['pt-BR', 'en'] : ['pt-BR'],
        setupCompletedAt: new Date(game.createdAt),
        platforms: game.platforms,
        buildVersion: game.buildVersion,
        estimatedMinutes: game.estimatedMinutes,
        isNew: game.isNew,
        specs: json(game.specs),
        createdAt: new Date(game.createdAt),
        updatedAt: new Date(game.updatedAt),
      },
    });
  }

  // --- Testes do estúdio de demonstração ------------------------------------
  let recibo = 1;
  const pagar = async (playtestId: string, studioId: string, total: number, quando: Date) => {
    await prisma.order.create({
      data: {
        studioId,
        playtestId,
        createdById: contaEstudio.id,
        method: 'PIX',
        status: 'PAID',
        amountCents: total,
        breakdown: json([{ label: 'Pedido importado das fixtures', amountCents: total }]),
        provider: 'sandbox',
        providerRef: `seed_${playtestId}`,
        receiptNumber: `OP-SEED-${String(recibo++).padStart(4, '0')}`,
        createdAt: quando,
        paidAt: quando,
      },
    });
  };

  for (const teste of tests) {
    const ativo = teste.status === 'ACTIVE' || teste.status === 'FULL';
    const build = await buildComArquivo(
      {
        gameId: teste.gameId,
        uploadedById: contaEstudio.id,
        version: teste.buildFileName.replace(/^.*?-(\d.*)\.zip$/, '$1'),
        status: 'VALID',
        pluginDetected: teste.plugin,
        pluginEnabled: teste.plugin,
        pluginSdkVersion: teste.plugin ? '1.0.0' : null,
        pluginTriggers: json(teste.plugin ? GATILHOS : []),
        pluginHeatmaps: json(teste.plugin ? MAPAS : []),
        // Só Windows: o e2e "build só para Windows" depende disto.
        platforms: ['PC'],
        createdAt: new Date(teste.createdAt),
      },
      teste.plugin ? 'plugin' : 'exe',
    );

    await prisma.playtest.create({
      data: {
        id: teste.id,
        gameId: teste.gameId,
        buildId: build.id,
        createdById: contaEstudio.id,
        title: teste.title,
        model: teste.model,
        status: teste.status,
        kind: teste.kind,
        plugin: teste.plugin,
        instructions: teste.instructions,
        requiresRecording: teste.requiresRecording,
        requiresMicrophone: teste.requiresMicrophone,
        requiresWebcam: teste.requiresWebcam,
        ...teste.audience,
        ...teste.budget,
        currentParticipants: teste.currentParticipants,
        estimatedMinutes: teste.estimatedMinutes,
        buildFileName: teste.buildFileName,
        buildSizeMb: teste.buildSizeMb,
        heatmapImages: json(teste.id === 'test-001' ? { 'Fase_01_São Paulo': './images/plugin/heatmap-player-fase-01.webp' } : {}),
        createdAt: new Date(teste.createdAt),
        startsAt: new Date(teste.createdAt),
        // Aberto ganha o prazo do Figma; fechado fica com o da fixture, que já passou.
        expiresAt: ativo ? emBreve() : new Date(teste.expiresAt),
        endedAt: teste.status === 'FINISHED' ? new Date(teste.expiresAt) : null,
        questions: { create: questionsOf(teste.questions) },
      },
    });
    await pagar(teste.id, 'studio-001', teste.budget.totalCents, new Date(teste.createdAt));
  }

  // O teste com o formulário completo: aberto, pago, com build real e sem
  // ninguém ainda — o jogador de demonstração vê "Começar!" e passa por todos
  // os tipos de pergunta na avaliação.
  {
    const build = await buildComArquivo(
      { gameId: 'game-001', uploadedById: contaEstudio.id, version: '1.3.0', status: 'VALID', platforms: ['PC'], createdAt: diasAtras(2) },
      'exe',
    );
    const orcamento = budgetOf('FREE_EXPLORATION', 50, 300);
    await prisma.playtest.create({
      data: {
        id: 'test-006',
        gameId: 'game-001',
        buildId: build.id,
        createdById: contaEstudio.id,
        title: 'Pista Noturna — avaliação completa',
        model: 'FREE_EXPLORATION',
        status: 'ACTIVE',
        kind: 'DEMO ABERTA',
        plugin: false,
        instructions: 'Jogue a Pista Noturna do começo ao fim e conte para a gente o que achou.',
        requiresRecording: false,
        requiresMicrophone: false,
        requiresWebcam: false,
        locations: ['GLOBAL'],
        playerType: 'ALL',
        archetype: 'ALL',
        minAge: 16,
        maxAge: 99,
        ...orcamento,
        currentParticipants: 0,
        estimatedMinutes: 15,
        buildFileName: build.fileName,
        buildSizeMb: build.sizeMb,
        createdAt: diasAtras(2),
        startsAt: diasAtras(2),
        expiresAt: emBreve(),
        questions: { create: questionsOf(PERGUNTAS_COMPLETAS) },
      },
    });
    await pagar('test-006', 'studio-001', orcamento.totalCents, diasAtras(2));
  }

  // --- Sessões dos testers ---------------------------------------------------
  const detalhe = reports.sessionDetail;
  const participacaoDaSessao = new Map(
    players.participations.map((part) => [part.testId, part] as const),
  );

  for (const [indice, sessao] of sessions.entries()) {
    const teste = tests.find((t) => t.id === sessao.testId)!;
    // "player-001" nas sessões é a conta de demonstração do jogador.
    const playerId = sessao.playerId;
    const perfil = perfilDe.get(playerId)!;
    const fixtureDoJogador = playerId === contaJogador.id ? participacaoDaSessao.get(sessao.testId) : undefined;
    const quando = new Date(sessao.recordedAt);
    const statusParticipacao = sessao.rewardStatus === 'PENDING' ? 'PENDING_REVIEW' : sessao.rewardStatus === 'REJECTED' ? 'REJECTED' : 'COMPLETED';

    const participacao = await prisma.participation.create({
      data: {
        id: fixtureDoJogador?.id,
        playtestId: teste.id,
        playerId,
        status: statusParticipacao,
        progress: 1,
        rewardCents: sessao.rewardCents,
        rewardStatus: sessao.rewardStatus,
        xpEarned: sessao.xpEarned,
        consentAt: new Date(quando.getTime() - sessao.durationSeconds * 1000),
        transcript: json(indice === 0 ? detalhe.transcript : [{ at: '00:00', text: sessao.transcript }]),
        startedAt: new Date(quando.getTime() - sessao.durationSeconds * 1000),
        finishedAt: quando,
        durationSeconds: sessao.durationSeconds,
      },
    });

    const criada = await prisma.session.create({
      data: {
        id: sessao.id,
        participationId: participacao.id,
        durationSeconds: sessao.durationSeconds,
        bugsFound: sessao.bugsFound,
        feedbackQuality: sessao.feedbackQuality * 2,
        overallRating: sessao.overallRating,
        // "Tempo médio da avaliação: 9m 14s".
        formSeconds: 480 + indice * 25,
        answers: json(answersOf(teste.questions, sessao.answers)),
        analysis: json(
          indice === 0
            ? { provider: 'seed', classification: detalhe.classification, evaluation: detalhe.evaluation, telemetry: detalhe.telemetry }
            : {
                provider: 'seed',
                classification: {
                  archetype: ARQUETIPOS.find((a) => a.id === perfil.archetype)!.name,
                  archetypeTone: TOM_ARQUETIPO[perfil.archetype],
                  playerType: TIPOS.find((t) => t.id === perfil.playerType)!.name,
                  score: sessao.feedbackQuality * 2,
                  funFactor: sessao.overallRating * 2,
                  engagement: Math.min(1, Number((sessao.durationSeconds / (teste.estimatedMinutes * 60)).toFixed(2))),
                  insights: sessao.insights.length,
                },
                evaluation: { score: sessao.feedbackQuality * 2, criteria: [] },
                telemetry: { triggers: 0, suggestions: 0, total: 0, events: [] },
              },
        ),
        outcome: json({
          gameId: teste.gameId,
          gameName: games.find((g) => g.id === teste.gameId)!.name,
          achievements: [],
          feedbackQuality: { total: sessao.feedbackQuality * 2, lines: [] },
          level: { from: 6, to: 6, gainedXp: sessao.xpEarned, progress: 0.6, lines: [] },
          reward: { totalCents: sessao.rewardCents, lines: [] },
        }),
        result: json({
          participationId: participacao.id,
          xpEarned: sessao.xpEarned,
          newXp: 900,
          newLevel: 6,
          leveledUp: false,
          rewardCents: sessao.rewardCents,
          rewardStatus: sessao.rewardStatus,
          unlockedAchievements: [],
          feedbackQuality: sessao.feedbackQuality * 2,
        }),
        validatedAt: sessao.rewardStatus === 'PENDING' ? null : quando,
        submittedAt: quando,
      },
    });

    await prisma.sessionEvent.createMany({
      data: sessao.timeline.map((evento) => ({
        participationId: participacao.id,
        atSecond: evento.atSecond,
        type: evento.type,
        label: evento.label,
        detail: evento.detail,
      })),
    });

    // Gatilhos do plug-in, para o relatório do plug-in ter o que contar.
    if (teste.plugin) {
      const gatilhos = Array.from({ length: 2 + indice * 2 }, (_, i) => ({
        participationId: participacao.id,
        atSecond: 300 + i * 45 + indice * 20,
        type: 'TRIGGER',
        label: i % 3 === 2 ? 'Menu_Loja' : 'BOSS01_Defeat',
        detail: i % 2 ? 'Aumento de voz' : undefined,
        payload: json({ duration: '1s' }),
      }));
      await prisma.sessionEvent.createMany({ data: gatilhos });

      // Posições e mortes no mapa, para o "Baixar mapa .OBJ" ter o que desenhar:
      // um percurso pela pista com um gargalo na rampa (x ≈ 40), como no relatório do Figma.
      const mapa = MAPAS[0].name;
      const posicoes = Array.from({ length: 60 }, (_, i) => {
        const t = i / 59;
        const x = Math.round((t * 80 + Math.sin(i + indice) * 3) * 10) / 10;
        const z = Math.round((Math.sin(t * Math.PI * 2) * 20 + indice * 1.5) * 10) / 10;
        return { participationId: participacao.id, atSecond: 10 + i * 20, type: 'POSITION', label: mapa, payload: json({ x, y: 0, z }) };
      });
      const mortes = Array.from({ length: 2 + (indice % 3) }, (_, i) => ({
        participationId: participacao.id,
        atSecond: 400 + i * 60,
        type: 'DEATH',
        label: mapa,
        detail: i % 2 ? 'Morte por colisão' : 'Morte por código',
        payload: json({ x: 40 + i, y: 0, z: 2 + i, cause: i % 2 ? 'COLLISION' : 'CODE' }),
      }));
      await prisma.sessionEvent.createMany({ data: [...posicoes, ...mortes] });
    }

    await prisma.insight.createMany({
      data: sessao.insights.map((insight) => ({
        playtestId: teste.id,
        sessionId: criada.id,
        title: insight.title,
        category: insight.category,
        categoryTone: TOM_CATEGORIA[insight.category] ?? 'sapphire',
        text: insight.description,
        severity: insight.severity,
        confidence: insight.confidence,
        createdAt: quando,
      })),
    });

    if (sessao.rewardCents > 0) {
      await prisma.ledgerEntry.create({
        data: {
          playerId,
          type: 'REWARD',
          status: sessao.rewardStatus === 'PENDING' ? 'PENDING' : sessao.rewardStatus === 'REJECTED' ? 'CANCELED' : 'AVAILABLE',
          amountCents: sessao.rewardCents,
          description: `${games.find((g) => g.id === teste.gameId)!.name} — ${teste.title}`,
          participationId: participacao.id,
          createdAt: quando,
        },
      });
    }
  }

  // O jogador de demonstração está no meio do test-001 (part-001 da fixture).
  const emAndamento = players.participations.find((part) => part.status === 'IN_PROGRESS');
  if (emAndamento) {
    await prisma.participation.create({
      data: {
        id: emAndamento.id,
        playtestId: emAndamento.testId,
        playerId: contaJogador.id,
        rewardCents: tests.find((t) => t.id === emAndamento.testId)!.budget.rewardPerSessionCents,
        startedAt: new Date(emAndamento.startedAt),
        progress: 0.3,
      },
    });
  }

  // Insights do teste inteiro e os dos dois blocos do plug-in.
  const insightsDo = (cards: FxCard[], kind: 'INSIGHT' | 'FINDING' | 'SUGGESTION', scope: 'REPORT' | 'HEATMAP' | 'TRIGGER') =>
    cards.map((card) => ({
      playtestId: 'test-001',
      kind,
      scope,
      title: card.title ?? '',
      category: card.category ?? '',
      categoryTone: card.categoryTone ?? 'sapphire',
      text: card.text ?? '',
    }));
  await prisma.insight.createMany({
    data: [
      ...insightsDo(reports.testReport.insights, 'INSIGHT', 'REPORT'),
      ...insightsDo(reports.pluginReport.heatmap.findings, 'FINDING', 'HEATMAP'),
      ...insightsDo(reports.pluginReport.heatmap.aiSuggestions, 'SUGGESTION', 'HEATMAP'),
      ...insightsDo(reports.pluginReport.triggers.findings, 'FINDING', 'TRIGGER'),
      ...insightsDo(reports.pluginReport.triggers.aiSuggestions, 'SUGGESTION', 'TRIGGER'),
    ],
  });

  // --- Horizon Chase 2: as tabelas que o Figma desenha para o jogador --------
  const MODELO_DO_TIPO: Record<string, FxTest['model']> = { 'A/B': 'AB_TEST', Qualitativo: 'AB_IMAGES' };
  const hcId = 'game-101';
  const hcEstudio = estudioDe(games.find((g) => g.id === hcId)!);
  const publico = { locations: ['GLOBAL'], playerType: 'ALL', archetype: 'ALL', minAge: 16, maxAge: 99 };

  const sessaoDoJogador = async (
    playtestId: string,
    participationId: string,
    minutos: number,
    reward: number,
    status: 'PENDING' | 'VALIDATED',
    quando: Date,
    outcome?: Record<string, unknown>,
  ) => {
    await prisma.session.create({
      data: {
        participationId,
        durationSeconds: minutos * 60,
        bugsFound: 1,
        feedbackQuality: 9.1,
        overallRating: 5,
        answers: json({
          'q-1': 5,
          'q-2': 9,
          'q-3': 4,
          'q-4': 4,
          'q-5': 'Sim',
          'q-6': 'A curva depois do túnel, dá uma sensação de velocidade absurda.',
          'q-7': 'Achei o salto da rampa pouco intuitivo; demorei para pegar o timing.',
        }),
        analysis: json({
          provider: 'seed',
          classification: { archetype: 'Explorador', archetypeTone: 'emerald', playerType: 'Casual', score: 9.1, funFactor: 10, engagement: 0.9, insights: 0 },
          evaluation: { score: 9.1, criteria: [] },
          telemetry: { triggers: 0, suggestions: 0, total: 0, events: [] },
        }),
        outcome: json(outcome ?? { gameId: hcId, gameName: 'Horizon Chase 2', achievements: [], feedbackQuality: { total: 9.1, lines: [] }, level: { from: 14, to: 14, gainedXp: 60, progress: 0.9, lines: [] }, reward: { totalCents: reward, lines: [] } }),
        result: json({ participationId, xpEarned: 60, newXp: 4500, newLevel: 14, leveledUp: false, rewardCents: reward, rewardStatus: status, unlockedAchievements: [], feedbackQuality: 9.1 }),
        validatedAt: status === 'VALIDATED' ? quando : null,
        submittedAt: quando,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        playerId: contaJogador.id,
        type: 'REWARD',
        status: status === 'PENDING' ? 'PENDING' : 'AVAILABLE',
        amountCents: reward,
        description: `Horizon Chase 2 — ${playtestId}`,
        participationId,
        createdAt: quando,
      },
    });
  };

  // Uma build com arquivo para todos os testes do Horizon Chase; sem plataforma, roda em qualquer sistema.
  const buildHc = await buildComArquivo(
    { gameId: hcId, uploadedById: 'owner-001', version: '1.3.0', status: 'VALID', platforms: [], createdAt: diasAtras(40) },
    'exe',
  );
  for (const [indice, linha] of players.gameTests[hcId].entries()) {
    const modelo = MODELO_DO_TIPO[linha.kind] ?? 'FREE_EXPLORATION';
    const comBuild = modelo !== 'AB_IMAGES';
    await prisma.playtest.create({
      data: {
        id: linha.id,
        gameId: hcId,
        buildId: comBuild ? buildHc.id : null,
        buildFileName: comBuild ? buildHc.fileName : '',
        buildSizeMb: comBuild ? buildHc.sizeMb : 0,
        title: linha.name,
        model: modelo,
        status: linha.action === 'UNAVAILABLE' ? 'PAUSED' : 'ACTIVE',
        kind: linha.kind,
        ...publico,
        ...budgetOf(modelo, linha.slotsTotal, linha.rewardCents, linha.boosted),
        currentParticipants: linha.slotsTaken,
        estimatedMinutes: linha.estimatedMinutes,
        createdAt: diasAtras(10),
        startsAt: diasAtras(10),
        expiresAt: emBreve(),
        questions: { create: questionsOf(PERGUNTAS_PADRAO) },
      },
    });
    await pagar(linha.id, hcEstudio, budgetOf(modelo, linha.slotsTotal, linha.rewardCents, linha.boosted).totalCents, diasAtras(10));

    if (['REVIEW', 'CONTINUE', 'DOWNLOADING'].includes(linha.action)) {
      const revisao = linha.action === 'REVIEW';
      const participacao = await prisma.participation.create({
        data: {
          playtestId: linha.id,
          playerId: contaJogador.id,
          status: revisao ? 'PENDING_REVIEW' : 'IN_PROGRESS',
          progress: linha.progress,
          rewardCents: linha.rewardCents,
          consentAt: diasAtras(1),
          // A sessão em andamento mais recente é a que o jogador revê (TELA 18).
          transcript: json(linha.action === 'CONTINUE' ? players.sessionReview.transcript : []),
          startedAt: new Date(agora - (indice + 1) * 30 * 60_000),
          finishedAt: revisao ? diasAtras(2) : null,
          durationSeconds: revisao ? linha.estimatedMinutes * 60 : null,
          xpEarned: revisao ? 60 : 0,
        },
      });
      if (revisao) await sessaoDoJogador(linha.id, participacao.id, linha.estimatedMinutes, linha.rewardCents, 'PENDING', diasAtras(2));
    }
  }

  // "Meus testes": o primeiro ainda em análise, os outros já encerrados e pagos.
  for (const [indice, linha] of players.gameMyTests.entries()) {
    const aberto = indice === 0;
    await prisma.playtest.create({
      data: {
        id: linha.id,
        gameId: hcId,
        buildId: buildHc.id,
        buildFileName: buildHc.fileName,
        buildSizeMb: buildHc.sizeMb,
        title: linha.name,
        model: 'FREE_EXPLORATION',
        status: aberto ? 'ACTIVE' : 'FINISHED',
        kind: linha.kind,
        ...publico,
        ...budgetOf('FREE_EXPLORATION', linha.slotsTotal, linha.rewardCents),
        currentParticipants: linha.slotsTaken,
        estimatedMinutes: linha.estimatedMinutes,
        createdAt: diasAtras(40 + indice * 7),
        startsAt: diasAtras(40 + indice * 7),
        expiresAt: aberto ? emBreve() : diasAtras(20 + indice * 7),
        endedAt: aberto ? null : diasAtras(20 + indice * 7),
        questions: { create: questionsOf(PERGUNTAS_PADRAO) },
      },
    });
    await pagar(linha.id, hcEstudio, budgetOf('FREE_EXPLORATION', linha.slotsTotal, linha.rewardCents).totalCents, diasAtras(40 + indice * 7));

    const quando = aberto ? diasAtras(1) : diasAtras(25 + indice * 7);
    const participacao = await prisma.participation.create({
      data: {
        playtestId: linha.id,
        playerId: contaJogador.id,
        status: aberto ? 'PENDING_REVIEW' : 'COMPLETED',
        rewardStatus: aberto ? 'PENDING' : 'VALIDATED',
        progress: 1,
        rewardCents: linha.rewardCents,
        xpEarned: 60,
        consentAt: quando,
        startedAt: new Date(quando.getTime() - linha.estimatedMinutes * 60_000),
        finishedAt: quando,
        durationSeconds: linha.estimatedMinutes * 60,
      },
    });
    // A mais recente carrega o "O que a sessão rendeu" do Figma (TELA 19).
    await sessaoDoJogador(
      linha.id,
      participacao.id,
      linha.estimatedMinutes,
      linha.rewardCents,
      aberto ? 'PENDING' : 'VALIDATED',
      quando,
      aberto ? players.sessionOutcome : undefined,
    );
  }

  // --- Um teste aberto por jogo de terceiros, para o catálogo ----------------
  for (const game of games.filter((g) => g.studioId !== 'studio-001' && g.id !== hcId && g.status === 'ACTIVE')) {
    const id = `seed-test-${game.id}`;
    const vagas = Math.max(100, game.stats.totalPlayers + 40);
    const orcamento = budgetOf('FREE_EXPLORATION', vagas, game.maxRewardCents || 250);
    const build = await buildComArquivo(
      { gameId: game.id, uploadedById: 'owner-001', version: '1.0.0', status: 'VALID', platforms: [], createdAt: diasAtras(5) },
      'exe',
    );
    await prisma.playtest.create({
      data: {
        id,
        gameId: game.id,
        buildId: build.id,
        buildFileName: build.fileName,
        buildSizeMb: build.sizeMb,
        title: `${game.name} — Demo aberta`,
        model: 'FREE_EXPLORATION',
        status: 'ACTIVE',
        kind: 'DEMO ABERTA',
        // "Exclusivos ELITE": o que mais paga fica só para o tier ELITE.
        eliteOnly: game.id === 'game-105',
        ...publico,
        ...orcamento,
        currentParticipants: game.stats.totalPlayers,
        estimatedMinutes: game.estimatedMinutes || 20,
        createdAt: diasAtras(5),
        startsAt: diasAtras(5),
        expiresAt: emBreve(),
        questions: { create: questionsOf(PERGUNTAS_PADRAO) },
      },
    });
    await pagar(id, estudioDe(game), orcamento.totalCents, diasAtras(5));
  }

  // --- Conquistas ------------------------------------------------------------
  const REGRAS: Record<string, string> = { 'ach-001': 'FIRST_SESSION', 'ach-002': 'BUGS_10', 'ach-003': 'HOURS_20', 'ach-004': 'QUALITY_STREAK_5' };
  await prisma.achievement.createMany({
    data: players.achievements.map((a) => ({ id: a.id, name: a.name, description: a.description, icon: a.icon, xp: a.xp, rule: REGRAS[a.id] ?? null })),
  });
  await prisma.playerAchievement.createMany({
    data: players.achievements
      .filter((a) => a.unlockedAt)
      .map((a) => ({ playerId: contaJogador.id, achievementId: a.id, unlockedAt: new Date(a.unlockedAt!) })),
  });

  // "Top 10% da Galáxia" e "Teste Persistente" continuam dadas à mão.
  const REGRAS_DO_JOGO: Record<string, string> = {
    'conq-1': 'GAME_FIRST_TEST',
    'conq-2': 'GAME_TESTS_10',
    'conq-3': 'FEEDBACK_100_CHARS',
    'conq-4': 'BUG_CONFIRMED',
    'conq-5': 'AI_INSIGHT_SOURCE',
    'conq-8': 'EXPERIMENTAL_BUILD',
    'conq-9': 'GAME_FIRST_REWARD',
  };
  for (const [position, card] of players.gameAchievements.entries()) {
    await prisma.gameAchievement.create({
      data: {
        id: card.id,
        gameId: hcId,
        title: card.title ?? '',
        description: card.description ?? '',
        icon: card.icon ?? '',
        rule: REGRAS_DO_JOGO[card.id] ?? null,
        position,
        players: card.locked ? undefined : { create: { playerId: contaJogador.id, gameId: hcId } },
      },
    });
  }

  // --- Comunidade ------------------------------------------------------------
  await prisma.communityChannel.createMany({ data: community.channels.map((c, position) => ({ ...c, position })) });
  for (const [gameId, mensagens] of Object.entries(community.messages)) {
    await prisma.chatMessage.createMany({
      data: mensagens.map((m, i) => ({
        id: m.id,
        gameId,
        channelId: m.channelId,
        authorId: m.authorId,
        text: m.text,
        // As fixtures repetem o mesmo minuto; um segundo de diferença mantém a ordem.
        sentAt: new Date(new Date(m.sentAt).getTime() + i * 1000),
      })),
    });
  }

  // Os QA que escrevem no #geral do game-001 testaram o jogo (test-002): o chat
  // só abre para quem participou de algum teste dele.
  for (const [i, playerId] of ['qa-cellbitos', 'qa-jones'].entries()) {
    const quando = diasAtras(12 + i);
    const minutos = 25;
    const participacao = await prisma.participation.create({
      data: {
        playtestId: 'test-002',
        playerId,
        status: 'COMPLETED',
        rewardStatus: 'VALIDATED',
        progress: 1,
        rewardCents: 300,
        xpEarned: 60,
        consentAt: quando,
        startedAt: new Date(quando.getTime() - minutos * 60_000),
        finishedAt: quando,
        durationSeconds: minutos * 60,
      },
    });
    await prisma.session.create({
      data: {
        participationId: participacao.id,
        durationSeconds: minutos * 60,
        bugsFound: 1,
        feedbackQuality: 8,
        overallRating: 4,
        answers: json({}),
        outcome: json({
          gameId: 'game-001',
          gameName: 'Racha de Rua!',
          achievements: [],
          feedbackQuality: { total: 8, lines: [] },
          level: { from: 1, to: 1, gainedXp: 60, progress: 0.5, lines: [] },
          reward: { totalCents: 300, lines: [] },
        }),
        result: json({
          participationId: participacao.id,
          xpEarned: 60,
          newXp: 60,
          newLevel: 1,
          leveledUp: false,
          rewardCents: 300,
          rewardStatus: 'VALIDATED',
          unlockedAchievements: [],
          feedbackQuality: 8,
        }),
        validatedAt: quando,
        submittedAt: quando,
      },
    });
  }

  // --- Equipe do estúdio (Figma `1187:9418` e `1188:10038`) -------------------
  // `teamPermissions` são as colunas "Criar/Editar usuário" e "Excluir usuário" de Gerenciamento de acessos.
  const equipe = [
    { id: 'studio-hideo', name: 'Hideo Kojima', permission: 'EDIT' as const, teamPermissions: ['MANAGE_USERS'] },
    { id: 'studio-guilherme', name: 'Guilherme Hoffmann', permission: 'EDIT' as const, teamPermissions: [] },
    { id: 'studio-pedro', name: 'Pedro Alves', permission: 'EDIT' as const, teamPermissions: [] },
    { id: 'studio-marina', name: 'Marina Lopes', permission: 'VIEW' as const, teamPermissions: [] },
  ];
  for (const [i, membro] of equipe.entries()) {
    await prisma.user.create({
      data: {
        id: membro.id,
        name: membro.name,
        email: `${slug(membro.name)}@estudio.orbitplay.com`,
        passwordHash: senha,
        role: 'STUDIO',
        studioId: 'studio-001',
        studioPermission: membro.permission,
        teamPermissions: membro.teamPermissions,
        lastLoginAt: diasAtras(i + 1),
      },
    });
  }
  // Um convite ainda não aceito: aparece como pendente na tabela de acessos.
  await prisma.user.create({
    data: {
      id: 'studio-convite',
      name: 'convite',
      email: 'convite@estudio.orbitplay.com',
      passwordHash: '!',
      role: 'STUDIO',
      status: 'PENDING',
      studioId: 'studio-001',
      studioPermission: 'EDIT',
    },
  });
  const grupos = [
    { id: 'group-diretores', name: 'Diretores', membros: [contaEstudio.id, 'studio-hideo'] },
    { id: 'group-qa', name: 'QA', membros: ['studio-guilherme', 'studio-pedro'] },
    { id: 'group-analitics', name: 'Analitics', membros: ['studio-marina'] },
  ];
  for (const grupo of grupos) {
    await prisma.studioGroup.create({
      data: { id: grupo.id, studioId: 'studio-001', name: grupo.name, members: { create: grupo.membros.map((userId) => ({ userId })) } },
    });
  }
  const TODAS = ['MANAGE_ACCESS', 'EDIT_INFO', 'MANAGE_TESTS', 'VIEW_REPORTS'];
  await prisma.gameAccess.createMany({
    data: [
      { gameId: 'game-001', groupId: 'group-diretores', permissions: TODAS },
      { gameId: 'game-001', groupId: 'group-qa', permissions: ['MANAGE_TESTS', 'VIEW_REPORTS'] },
      { gameId: 'game-001', groupId: 'group-analitics', permissions: ['VIEW_REPORTS'] },
      { gameId: 'game-001', userId: 'studio-hideo', permissions: TODAS },
      { gameId: 'game-001', userId: 'studio-guilherme', permissions: ['EDIT_INFO', 'MANAGE_TESTS', 'VIEW_REPORTS'] },
    ],
  });

  // --- OrbitPlug-in: código de acesso e o que a Unity enviou ------------------
  await prisma.pluginKey.create({
    data: {
      gameId: 'game-001',
      codeHash: createHash('sha256').update(CODIGO_PLUGIN_DEMO).digest('hex'),
      last4: CODIGO_PLUGIN_DEMO.slice(-4),
      name: 'Unity — máquina do Hideo',
      createdById: contaEstudio.id,
      lastUsedAt: diasAtras(1),
    },
  });
  await prisma.gamePluginConfig.create({
    data: { gameId: 'game-001', sdkVersion: '1.0.0', maps: json(CONFIG_PLUGIN.maps), triggers: json(CONFIG_PLUGIN.triggers) },
  });

  // --- Notificações do sino --------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        userId: contaJogador.id,
        type: 'REWARD_RELEASED',
        title: 'Recompensa liberada!',
        body: 'R$ 2,50 de Horizon Chase 2 já estão no seu saldo.',
        link: '/player/wallet',
        createdAt: diasAtras(2),
      },
      {
        userId: contaJogador.id,
        type: 'STUDIO_THANKS',
        title: 'Horizon Chase 2 agradeceu seu teste!',
        body: 'Valeu pelo feedback da Pista Terra — o salto da rampa já está na lista de ajustes.',
        link: '/player/games/game-101',
        createdAt: diasAtras(1),
      },
      {
        userId: contaEstudio.id,
        type: 'SESSION_SUBMITTED',
        title: 'Nova sessão para validar',
        body: 'Um tester enviou "Pista Terra v1.3" de Racha de Rua!.',
        link: '/studio/games/game-001',
        createdAt: diasAtras(1),
      },
    ],
  });

  // --- Carteiras: o saldo é a soma do extrato --------------------------------
  // O jogador de demonstração traz o saldo do Figma como saldo inicial.
  const disponivel = await prisma.ledgerEntry.aggregate({
    where: { playerId: contaJogador.id, status: 'AVAILABLE' },
    _sum: { amountCents: true },
  });
  const saldoFigma = Number(p.balance);
  const ajuste = saldoFigma - (disponivel._sum.amountCents ?? 0);
  if (ajuste !== 0) {
    await prisma.ledgerEntry.create({
      data: { playerId: contaJogador.id, type: 'ADJUSTMENT', status: 'AVAILABLE', amountCents: ajuste, description: 'Saldo inicial', createdAt: diasAtras(60) },
    });
  }

  for (const playerId of [contaJogador.id, ...testers.map((t) => t.id)]) {
    const [livre, pendente] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { playerId, status: 'AVAILABLE' }, _sum: { amountCents: true } }),
      prisma.ledgerEntry.aggregate({ where: { playerId, status: 'PENDING' }, _sum: { amountCents: true } }),
    ]);
    await prisma.playerProfile.update({
      where: { userId: playerId },
      data: { balanceCents: livre._sum.amountCents ?? 0, pendingBalanceCents: pendente._sum.amountCents ?? 0 },
    });
  }

  const contagem = await Promise.all([
    prisma.user.count(),
    prisma.game.count(),
    prisma.playtest.count(),
    prisma.session.count(),
    prisma.insight.count(),
  ]);
  console.log(`Seed pronto: ${contagem[0]} contas, ${contagem[1]} jogos, ${contagem[2]} testes, ${contagem[3]} sessões, ${contagem[4]} insights.`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
