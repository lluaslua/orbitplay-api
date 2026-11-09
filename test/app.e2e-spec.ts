import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { WithdrawalSettlementService } from '../src/modules/wallet/withdrawal-settlement.service';

/**
 * Fluxos de ponta a ponta contra o banco do .env, depois de `npm run db:seed`.
 * As contas vêm do seed; o que os testes escrevem, eles mesmos criam — dá para
 * rodar de novo sem refazer o seed.
 */
describe('OrbitPlay API (e2e)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());

  const login = async (email: string, role: 'STUDIO' | 'PLAYER') => {
    const { body } = await api().post('/api/auth/login').send({ email, password: '123456', role }).expect(200);
    return body.token as string;
  };

  let estudio: string;
  let jogador: string;
  let owner: string;

  beforeAll(async () => {
    // Esta suíte dispara centenas de chamadas do mesmo IP: o limite de taxa é testado em security.e2e-spec.ts.
    process.env.RATE_LIMIT_DISABLED = 'true';
    // O Pix simulado roda sozinho de 5 em 5 s; aqui ele é chamado à mão para o saque não mudar de status no meio de um caso.
    process.env.SIMULATED_PAYOUT_SECONDS = '0';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    // Os testes de credencial errada contam falhas na conta do seed; zera para a suíte ser repetível.
    await app.get(PrismaService).user.updateMany({ data: { failedLoginCount: 0, lockedUntil: null } });

    [estudio, jogador, owner] = await Promise.all([
      login('studio@orbitplay.com', 'STUDIO'),
      login('player@orbitplay.com', 'PLAYER'),
      login('owner@orbitplay.com', 'PLAYER'),
    ]);
  });

  afterAll(() => app.close());

  describe('Login (Tela 01)', () => {
    it('recusa credencial inválida sem dizer se foi o e-mail ou a senha', async () => {
      const { body } = await api()
        .post('/api/auth/login')
        .send({ email: 'studio@orbitplay.com', password: 'errada', role: 'STUDIO' })
        .expect(401);
      expect(body).toEqual({ message: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
    });

    it('recusa estúdio na aba de tester', async () => {
      const { body } = await api()
        .post('/api/auth/login')
        .send({ email: 'studio@orbitplay.com', password: '123456', role: 'PLAYER' })
        .expect(403);
      expect(body.code).toBe('ROLE_MISMATCH');
    });

    it('devolve a conta com a organização do estúdio', async () => {
      const { body } = await api().get('/api/auth/me').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body.role).toBe('STUDIO');
      expect(body.studio).toMatchObject({ studioId: 'studio-001', permission: 'MANAGE' });
    });

    it('exige token nas rotas privadas', () => api().get('/api/auth/me').expect(401));
  });

  describe('Escopo', () => {
    it('o estúdio só vê os jogos da própria organização', async () => {
      const res = await api().get('/api/games').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((g: { studioId: string }) => g.studioId === 'studio-001')).toBe(true);
      expect(res.headers['x-total-count']).toBe(String(res.body.length));
    });

    it('o jogador só vê jogos ativos', async () => {
      const { body } = await api().get('/api/games').set('Authorization', `Bearer ${jogador}`).expect(200);
      expect(body.every((g: { status: string }) => g.status === 'ACTIVE')).toBe(true);
    });

    it('rota de estúdio recusa jogador', () =>
      api().get('/api/studio/dashboard').set('Authorization', `Bearer ${jogador}`).expect(403));
  });

  describe('Novo teste, pagamento e publicação (Telas 06 a 10)', () => {
    const rascunho = (extra: Record<string, unknown> = {}) => ({
      gameId: 'game-001',
      model: 'AB_IMAGES',
      title: '',
      instructions: '',
      questions: [{ id: 'q-e2e-1', type: 'MULTIPLE_CHOICE', label: 'Qual versão você prefere?', required: true, options: ['A', 'B'] }],
      requiresRecording: false,
      requiresMicrophone: false,
      requiresWebcam: false,
      audience: { locations: ['GLOBAL'], playerType: 'ALL', archetype: 'ALL', minAge: 16, maxAge: 99 },
      budget: {
        slots: 2,
        untilDisabled: false,
        basePriceCents: 0,
        audienceCents: 0,
        boostCents: 0,
        pricePerTestCents: 0,
        totalCents: 1,
        rewardPerSessionCents: 100,
        durationDays: 7,
      },
      ...extra,
    });

    let testId: string;

    it('cota o preço na API', async () => {
      const { body } = await api()
        .post('/api/pricing/quote')
        .set('Authorization', `Bearer ${estudio}`)
        .send({ model: 'TELEMETRY', playerType: 'CASUAL', boost: true, slots: 750, untilDisabled: false, rewardPerSessionCents: 250, durationDays: 14 })
        .expect(200);
      expect(body).toMatchObject({ basePriceCents: 69, audienceCents: 0, boostCents: 15, pricePerTestCents: 84, totalCents: 63000 });
    });

    it('não publica sem build validada', async () => {
      const { body } = await api()
        .post('/api/tests')
        .set('Authorization', `Bearer ${estudio}`)
        .send(rascunho({ model: 'FREE_EXPLORATION' }))
        .expect(422);
      expect(body.code).toBe('BUILD_NOT_READY');
    });

    it('recusa pergunta de escolha com uma opção só', async () => {
      const { body } = await api()
        .post('/api/tests')
        .set('Authorization', `Bearer ${estudio}`)
        .send(rascunho({ questions: [{ id: 'q-1', type: 'DROPDOWN', label: 'Escolha uma', required: true, options: ['A'] }] }))
        .expect(400);
      expect(body.fields['questions.0.options']).toBeDefined();
    });

    it('cria como rascunho e ignora o preço que o app mandou', async () => {
      const { body } = await api().post('/api/tests').set('Authorization', `Bearer ${estudio}`).send(rascunho()).expect(201);
      testId = body.id;
      expect(body.status).toBe('DRAFT');
      // AB_IMAGES (19) + perfil "Todos" (10), × 2 vagas.
      expect(body.budget).toMatchObject({ pricePerTestCents: 29, totalCents: 58 });
    });

    it('paga, publica e não cobra de novo', async () => {
      const primeiro = await api()
        .post(`/api/tests/${testId}/checkout`)
        .set('Authorization', `Bearer ${estudio}`)
        .send({ method: 'PIX' })
        .expect(201);
      expect(primeiro.body).toMatchObject({ status: 'PAID', amountCents: 58 });

      const segundo = await api()
        .post(`/api/tests/${testId}/checkout`)
        .set('Authorization', `Bearer ${estudio}`)
        .send({ method: 'CARD' })
        .expect(201);
      expect(segundo.body.id).toBe(primeiro.body.id);

      const teste = await api().get(`/api/tests/${testId}`).set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(teste.body.status).toBe('ACTIVE');

      const recibo = await api()
        .get(`/api/payments/${primeiro.body.id}/receipt`)
        .set('Authorization', `Bearer ${estudio}`)
        .expect(200);
      expect(recibo.body.receiptNumber).toMatch(/^OP-/);
    });

    describe('O jogador no teste publicado (Telas 16 a 19)', () => {
      let participationId: string;
      let saldoAntes: number;

      it('começa uma vez só', async () => {
        const a = await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${jogador}`).expect(201);
        const b = await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${jogador}`).expect(201);
        participationId = a.body.id;
        expect(b.body.id).toBe(participationId);
        expect(a.body.status).toBe('IN_PROGRESS');

        // A verba do teste diminui: cada vaga ocupada tira uma recompensa do que sobra (2 vagas × R$ 1,00).
        const teste = await api().get(`/api/tests/${testId}`).set('Authorization', `Bearer ${estudio}`).expect(200);
        expect(teste.body.currentParticipants).toBe(1);
        expect(teste.body.budget.slots - teste.body.currentParticipants).toBe(1);
      });

      it('recusa o formulário sem a resposta obrigatória', async () => {
        const { body } = await api()
          .post(`/api/player/tests/${testId}/submit`)
          .set('Authorization', `Bearer ${jogador}`)
          .send({ participationId, answers: {}, bugsReported: 0, durationSeconds: 120 })
          .expect(400);
        expect(body.code).toBe('REQUIRED_ANSWERS');
        expect(body.fields).toHaveProperty(['answers.q-e2e-1']);
      });

      it('envia, e o segundo envio devolve o mesmo resultado', async () => {
        saldoAntes = (await api().get('/api/player/wallet').set('Authorization', `Bearer ${jogador}`).expect(200)).body.balanceCents;

        // O bug informado precisa ter sido registrado como evento (a API não aceita o número solto do cliente).
        await api()
          .post(`/api/player/participations/${participationId}/events`)
          .set('Authorization', `Bearer ${jogador}`)
          .send({ events: [{ atSecond: 1, type: 'BUG', label: 'Travou na curva' }] })
          .expect(201);
        const envio = { participationId, answers: { 'q-e2e-1': 'B' }, bugsReported: 1, durationSeconds: 30 };
        const a = await api().post(`/api/player/tests/${testId}/submit`).set('Authorization', `Bearer ${jogador}`).send(envio).expect(201);
        const b = await api().post(`/api/player/tests/${testId}/submit`).set('Authorization', `Bearer ${jogador}`).send(envio).expect(201);
        expect(a.body.rewardStatus).toBe('PENDING');
        expect(b.body).toEqual(a.body);

        const outcome = await api()
          .get(`/api/player/session-outcome?testId=${testId}`)
          .set('Authorization', `Bearer ${jogador}`)
          .expect(200);
        // Crédito base 100 + feedback completo 5 + bug reportado 5 (Figma `287:5085`).
        expect(outcome.body.reward.totalCents).toBe(110);
        expect(outcome.body.level.lines).toEqual(['XP base: 50', 'Bônus por feedback completo: +5', 'Bônus por bug reportado: +5']);

        // O saldo do tester sobe no envio, sem esperar o estúdio avaliar.
        const carteira = await api().get('/api/player/wallet').set('Authorization', `Bearer ${jogador}`).expect(200);
        expect(carteira.body.balanceCents).toBe(saldoAntes + 110);
        expect(carteira.body.transactions[0]).toMatchObject({ type: 'REWARD', status: 'AVAILABLE', amountCents: 110 });
      });

      it('a aprovação do estúdio leva a recompensa ao saldo, uma vez', async () => {
        const sessoes = await api().get(`/api/sessions?testId=${testId}`).set('Authorization', `Bearer ${estudio}`).expect(200);
        expect(sessoes.body).toHaveLength(1);
        const id = sessoes.body[0].id;

        const aprovada = await api()
          .post(`/api/sessions/${id}/validation`)
          .set('Authorization', `Bearer ${estudio}`)
          .send({ approved: true })
          .expect(200);
        expect(aprovada.body.rewardStatus).toBe('VALIDATED');
        await api().post(`/api/sessions/${id}/validation`).set('Authorization', `Bearer ${estudio}`).send({ approved: true }).expect(409);

        const carteira = await api().get('/api/player/wallet').set('Authorization', `Bearer ${jogador}`).expect(200);
        expect(carteira.body.balanceCents).toBe(saldoAntes + 110);

        // O sino do jogador avisa.
        const avisos = await api().get('/api/notifications?unread=true').set('Authorization', `Bearer ${jogador}`).expect(200);
        expect(avisos.body.some((n: { type: string; data: { sessionId?: string } }) => n.type === 'REWARD_RELEASED' && n.data?.sessionId === id)).toBe(true);

        // O teste que o tester acabou de fazer não serve de convite.
        const convite = await api()
          .post(`/api/sessions/${id}/retest`)
          .set('Authorization', `Bearer ${estudio}`)
          .send({ testId })
          .expect(422);
        expect(convite.body.code).toBe('RETEST_NOT_ALLOWED');
      });

      it('um segundo tester completa o teste: a verba acaba, o teste enche e a recusa do estúdio estorna o saldo', async () => {
        const email = `segundo-${Date.now()}@teste.orbitplay.com`;
        const conta = await api()
          .post('/api/auth/register')
          .send({ role: 'PLAYER', name: 'Segundo tester', email, password: 'Tester@2026x', birthDate: '2000-01-01', location: 'BRASIL' })
          .expect(201);
        const segundo = conta.body.token as string;
        const carteira = async () =>
          (await api().get('/api/player/wallet').set('Authorization', `Bearer ${segundo}`).expect(200)).body;

        const comeco = await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${segundo}`).expect(201);
        const cheio = await api().get(`/api/tests/${testId}`).set('Authorization', `Bearer ${estudio}`).expect(200);
        expect(cheio.body.currentParticipants).toBe(2);
        expect(cheio.body.status).toBe('FULL');

        const envio = await api()
          .post(`/api/player/tests/${testId}/submit`)
          .set('Authorization', `Bearer ${segundo}`)
          .send({ participationId: comeco.body.id, answers: { 'q-e2e-1': 'A' }, bugsReported: 0, durationSeconds: 30 })
          .expect(201);
        const ganho = envio.body.rewardCents as number;
        expect(ganho).toBeGreaterThan(0);
        expect((await carteira()).balanceCents).toBe(ganho);

        const sessao = await app
          .get(PrismaService)
          .session.findFirstOrThrow({ where: { participation: { playtestId: testId, playerId: (await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } })).id } } });
        await api()
          .post(`/api/sessions/${sessao.id}/validation`)
          .set('Authorization', `Bearer ${estudio}`)
          .send({ approved: false, note: 'Sem gravação.' })
          .expect(200);

        const depois = await carteira();
        expect(depois.balanceCents).toBe(0);
        expect(depois.transactions[0]).toMatchObject({ type: 'REWARD', status: 'CANCELED', amountCents: ganho });
      });
    });
  });

  describe('Novo jogo (Figma 1180:3359 a 1188:10297)', () => {
    let gameId: string;

    it('lista as opções dos dropdowns', async () => {
      const { body } = await api().get('/api/games/options').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body.genres).toHaveLength(41);
      expect(body.subGenres).toHaveLength(109);
      expect(body.developmentStages.map((s: { label: string }) => s.label)).toContain('Lançado');
      expect(body.platforms).toContainEqual({ value: 'PC', label: 'Windows' });
    });

    it('salva o rascunho só com o nome e cobra o resto no Finalizar', async () => {
      const criado = await api()
        .post('/api/games')
        .set('Authorization', `Bearer ${estudio}`)
        .send({ name: 'Jogo do e2e', genres: ['Racing'], gameModes: ['SINGLE_PLAYER'] })
        .expect(201);
      gameId = criado.body.id;
      expect(criado.body).toMatchObject({ status: 'DRAFT', setupCompleted: false, genres: ['Racing'] });

      const { body } = await api().post(`/api/games/${gameId}/finish-setup`).set('Authorization', `Bearer ${estudio}`).expect(400);
      expect(body.code).toBe('GAME_SETUP_INCOMPLETE');
      expect(Object.keys(body.fields)).toEqual(expect.arrayContaining(['tagline', 'logoUrl', 'bannerUrl']));
      // Sub-gênero e trailer não têm * na tela do app.
      expect(body.fields).not.toHaveProperty('subGenres');
      expect(body.fields).not.toHaveProperty('trailerUrl');
      expect(body.fields).not.toHaveProperty('gameModes');
    });

    it('não aceita teste antes do Finalizar', async () => {
      const { body } = await api()
        .post('/api/tests')
        .set('Authorization', `Bearer ${estudio}`)
        .send({
          gameId,
          model: 'AB_IMAGES',
          title: '',
          instructions: '',
          questions: [{ id: 'q-1', type: 'SHORT_TEXT', label: 'O que achou?', required: true }],
          requiresRecording: false,
          requiresMicrophone: false,
          requiresWebcam: false,
          audience: { locations: ['GLOBAL'], playerType: 'ALL', archetype: 'ALL', minAge: 16, maxAge: 99 },
          budget: { slots: 1, untilDisabled: false, basePriceCents: 0, audienceCents: 0, boostCents: 0, pricePerTestCents: 0, totalCents: 0, rewardPerSessionCents: 10, durationDays: 7 },
        })
        .expect(422);
      expect(body.code).toBe('GAME_SETUP_INCOMPLETE');
    });

    it('aceita o gênero como a tela mostra e recusa o que não está na lista', async () => {
      const aceito = await api().patch(`/api/games/${gameId}`).set('Authorization', `Bearer ${estudio}`).send({ genres: ['Corrida'] }).expect(200);
      expect(aceito.body.genres).toEqual(['Racing']);

      const { body } = await api()
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${estudio}`)
        .send({ genres: ['Xadrez Quântico'] })
        .expect(400);
      expect(body.fields).toHaveProperty('genres');
    });

    it('exclui o projeto sem teste publicado', async () => {
      await api().delete(`/api/games/${gameId}`).set('Authorization', `Bearer ${estudio}`).expect(200);
      await api().get(`/api/games/${gameId}`).set('Authorization', `Bearer ${estudio}`).expect(404);
    });

    it('não exclui jogo com teste publicado', async () => {
      const { body } = await api().delete('/api/games/game-001').set('Authorization', `Bearer ${estudio}`).expect(409);
      expect(body.code).toBe('GAME_HAS_TESTS');
    });
  });

  describe('Equipe e permissões por jogo (Figma 1187:9418 e 1188:10038)', () => {
    let pedro: string;
    let marina: string;
    let hideo: string;

    beforeAll(async () => {
      [pedro, marina, hideo] = await Promise.all([
        login('pedro-alves@estudio.orbitplay.com', 'STUDIO'),
        login('marina-lopes@estudio.orbitplay.com', 'STUDIO'),
        login('hideo-kojima@estudio.orbitplay.com', 'STUDIO'),
      ]);
    });

    it('busca membros com @ e lista os grupos', async () => {
      const membros = await api().get('/api/studio/members?search=@hideo').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(membros.body).toHaveLength(1);
      expect(membros.body[0].groups).toContainEqual(expect.objectContaining({ name: 'Diretores' }));

      const grupos = await api().get('/api/studio/groups').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(grupos.body.map((g: { name: string }) => g.name)).toEqual(['Analitics', 'Diretores', 'QA']);
    });

    it('mostra a tabela de permissões do jogo', async () => {
      const { body } = await api().get('/api/games/game-001/access').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body).toContainEqual(expect.objectContaining({ kind: 'GROUP', name: 'Analitics', permissions: ['VIEW_REPORTS'] }));
    });

    it('QA cria testes mas não edita as informações do jogo', async () => {
      const acesso = await api().get('/api/games/game-001/my-access').set('Authorization', `Bearer ${pedro}`).expect(200);
      expect(acesso.body.permissions).toEqual(['MANAGE_TESTS', 'VIEW_REPORTS']);

      const { body } = await api().patch('/api/games/game-001').set('Authorization', `Bearer ${pedro}`).send({ tagline: 'x' }).expect(403);
      expect(body.code).toBe('GAME_PERMISSION');
    });

    it('Analitics lê o relatório', () =>
      api().get('/api/reports/test-001').set('Authorization', `Bearer ${marina}`).expect(200));

    it('jogo novo fica só com quem criou (e com a gestão)', async () => {
      const criado = await api().post('/api/games').set('Authorization', `Bearer ${hideo}`).send({ name: 'Protótipo do Hideo' }).expect(201);
      await api().get(`/api/games/${criado.body.id}`).set('Authorization', `Bearer ${pedro}`).expect(404);
      await api().get(`/api/games/${criado.body.id}`).set('Authorization', `Bearer ${estudio}`).expect(200);
      await api().delete(`/api/games/${criado.body.id}`).set('Authorization', `Bearer ${hideo}`).expect(200);
    });

    it('só a gestão convida para a equipe', () =>
      api().post('/api/studio/members').set('Authorization', `Bearer ${pedro}`).send({ name: 'X', email: 'x@x.com' }).expect(403));
  });

  describe('OrbitPlug-in (Figma 423:2774 e 423:3000)', () => {
    const CODIGO = 'opk_demo_racha_de_rua_0001';

    it('valida o código de acesso', async () => {
      const { body } = await api().post('/api/plugin/validate').set('X-Orbit-Plugin-Key', CODIGO).expect(200);
      expect(body).toMatchObject({ valid: true, gameId: 'game-001', gameName: 'Racha de Rua!' });
      expect(body.config.triggers.map((t: { name: string }) => t.name)).toContain('Especial_Boost');
    });

    it('recusa código errado', async () => {
      const { body } = await api().post('/api/plugin/validate').set('X-Orbit-Plugin-Key', 'opk_errado').expect(401);
      expect(body.code).toBe('INVALID_PLUGIN_KEY');
    });

    it('recebe a telemetria do jogo com o token da participação', async () => {
      const { body: token } = await api()
        .post('/api/player/participations/part-001/telemetry-token')
        .set('Authorization', `Bearer ${jogador}`)
        .expect(200);

      const { body } = await api()
        .post('/api/plugin/telemetry')
        .set('Authorization', `Bearer ${token.token}`)
        .send({
          events: [
            { atSecond: 30, type: 'TRIGGER', label: 'BOSS01_Defeat', value: 1 },
            { atSecond: 31, type: 'DEATH', label: 'Fase_01_São Paulo', x: 40, y: 0, z: 2, cause: 'COLLISION' },
          ],
        })
        .expect(201);
      expect(body).toEqual({ received: 2 });

      // O token do plug-in não abre as rotas do jogador.
      await api().get('/api/player/dashboard').set('Authorization', `Bearer ${token.token}`).expect(401);
    });

    it('exporta o mapa de calor em .OBJ', async () => {
      const res = await api()
        .get(`/api/reports/test-001/plugin/heatmaps/${encodeURIComponent('Fase_01_São Paulo')}/export?format=obj&cell=5`)
        .set('Authorization', `Bearer ${estudio}`)
        .expect(200);
      expect(res.text.startsWith('# OrbitPlay heatmap')).toBe(true);
      expect(res.text).toContain('o densidade');
    });
  });

  describe('Catálogo, ELITE e dispositivo (Figma 849:2926 e 199:1291)', () => {
    let novato: string;

    beforeAll(async () => {
      const { body } = await api()
        .post('/api/auth/register')
        .send({
          role: 'PLAYER',
          name: 'Tester e2e',
          email: `e2e-${Date.now()}@teste.orbitplay.com`,
          password: 'Orbit#Teste-2026',
          birthDate: '2000-01-01',
          location: 'BRASIL',
          playerType: 'CASUAL',
          archetype: 'EXPLORER',
        })
        .expect(201);
      novato = body.token;
    });

    it('a aba ELITE lista só jogos com teste exclusivo', async () => {
      const { body } = await api().get('/api/games?tab=ELITE').set('Authorization', `Bearer ${novato}`).expect(200);
      expect(body.map((g: { id: string }) => g.id)).toEqual(['game-105']);
    });

    it('NOVATO não entra no teste exclusivo', async () => {
      const { body } = await api().post('/api/player/tests/seed-test-game-105/start').set('Authorization', `Bearer ${novato}`).expect(403);
      expect(body.code).toBe('ELITE_ONLY');
    });

    it('build só para Windows fica indisponível no Mac', async () => {
      const catalogo = await api().get('/api/player/catalog').set('Authorization', `Bearer ${novato}`).set('X-Client-Platform', 'darwin').expect(200);
      expect(catalogo.body.find((c: { testId: string }) => c.testId === 'test-001')).toMatchObject({
        status: 'UNAVAILABLE',
        unavailableReason: 'DEVICE_INCOMPATIBLE',
      });

      const { body } = await api()
        .post('/api/player/tests/test-001/start')
        .set('Authorization', `Bearer ${novato}`)
        .set('X-Client-Platform', 'darwin')
        .expect(409);
      expect(body.code).toBe('DEVICE_INCOMPATIBLE');
    });

    it('a landing lista jogos sem login', async () => {
      const { body } = await api().get('/api/public/games?tab=TOP_PAYING').expect(200);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).not.toHaveProperty('studioId');
    });

    it('ranking da semana com o Top 10', async () => {
      const { body } = await api().get('/api/player/ranking?period=week').set('Authorization', `Bearer ${jogador}`).expect(200);
      expect(body.period).toBe('week');
      expect(body.top.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Comunidade (Tela 15)', () => {
    it('quem jogou entra e conversa', async () => {
      await api().get('/api/games/game-001/community').set('Authorization', `Bearer ${jogador}`).expect(200);
      const { body } = await api()
        .post('/api/games/game-001/community/channels/geral/messages')
        .set('Authorization', `Bearer ${jogador}`)
        .send({ text: 'Mensagem do teste e2e' })
        .expect(201);
      expect(body).toMatchObject({ own: true, reacted: false });
    });

    it('mensagem vazia é recusada com o código do mock', async () => {
      const { body } = await api()
        .post('/api/games/game-001/community/channels/geral/messages')
        .set('Authorization', `Bearer ${jogador}`)
        .send({ text: '   ' })
        .expect(422);
      expect(body.code).toBe('EMPTY_MESSAGE');
    });

    it('quem nunca jogou não entra', async () => {
      const { body: conta } = await api()
        .post('/api/auth/register')
        .send({ role: 'PLAYER', name: 'Curioso', email: `curioso-${Date.now()}@teste.orbitplay.com`, password: 'Orbit#Teste-2026' })
        .expect(201);
      const { body } = await api().get('/api/games/game-001/community').set('Authorization', `Bearer ${conta.token}`).expect(403);
      expect(body.code).toBe('COMMUNITY_RESTRICTED');
    });

    it('o QA que escreve no #geral testou o jogo e entra', async () => {
      const cellbitos = await login('cellbitos@teste.orbitplay.com', 'PLAYER');
      await api().get('/api/games/game-001/community').set('Authorization', `Bearer ${cellbitos}`).expect(200);
    });
  });

  describe('Cadastro e conta (tela de registro do app)', () => {
    it('cria o estúdio com organização própria e entra', async () => {
      const email = `estudio-${Date.now()}@e2e.orbitplay.com`;
      const { body } = await api()
        .post('/api/auth/register')
        .send({ role: 'STUDIO', name: 'Ana Dev', email, password: 'Orbit#Teste-2026', organization: 'Estúdio e2e', website: 'https://e2e.dev' })
        .expect(201);
      expect(body.user.role).toBe('STUDIO');
      expect(body.user.studio).toMatchObject({ organization: 'Estúdio e2e', permission: 'MANAGE' });
      expect(body.user.studio.studioId).not.toBe(body.user.id);

      // Organização nova começa sem jogos — mesmo pedindo pelo id da conta.
      const jogos = await api().get(`/api/games?studioId=${body.user.id}`).set('Authorization', `Bearer ${body.token}`).expect(200);
      expect(jogos.body).toEqual([]);

      const repetido = await api()
        .post('/api/auth/register')
        .send({ role: 'STUDIO', name: 'Ana Dev', email, password: 'Orbit#Teste-2026', organization: 'Outra' })
        .expect(409);
      expect(repetido.body.code).toBe('EMAIL_TAKEN');
    });

    it('cria o tester com os dados de público', async () => {
      const { body } = await api()
        .post('/api/auth/register')
        .send({
          role: 'PLAYER',
          name: 'Bia Tester',
          email: `tester-${Date.now()}@e2e.orbitplay.com`,
          password: 'Orbit#Teste-2026',
          birthDate: '1999-05-10',
          location: 'BRASIL',
          playerType: 'EXPERIENT',
          archetype: 'EXPLORER',
        })
        .expect(201);
      expect(body.user.player).toMatchObject({ location: 'BRASIL', playerType: 'EXPERIENT', archetype: 'EXPLORER', birthDate: '1999-05-10' });
    });

    it('recusa senha curta', () =>
      api()
        .post('/api/auth/register')
        .send({ role: 'PLAYER', name: 'Curto', email: `curto-${Date.now()}@e2e.orbitplay.com`, password: '1234567' })
        .expect(400));

    it('senha atual errada responde 400 e não derruba a sessão', async () => {
      const { body } = await api()
        .post('/api/me/password')
        .set('Authorization', `Bearer ${jogador}`)
        .send({ currentPassword: 'errada', newPassword: 'NovaSenha@1' })
        .expect(400);
      expect(body.code).toBe('WRONG_PASSWORD');
      await api().get('/api/auth/me').set('Authorization', `Bearer ${jogador}`).expect(200);
    });
  });

  describe('Fluxo completo pelo app: Novo jogo, build, teste e avaliação', () => {
    // PNG 1×1: o app manda as imagens do rascunho como data URL.
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const esperar = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms));
    let gameId: string;
    let buildId: string;
    let testId: string;
    let tester: string;
    let participationId: string;

    it('Novo jogo com os rótulos da tela e as imagens do rascunho', async () => {
      const { body } = await api()
        .post('/api/games')
        .set('Authorization', `Bearer ${estudio}`)
        .send({
          name: `Corrida do e2e ${Date.now()}`,
          tagline: 'Acelere pela cidade',
          shortDescription: 'Um jogo de corrida para o fluxo completo.',
          description: 'Um jogo de corrida para o fluxo completo.',
          genres: ['Corrida', 'Ação'],
          subGenres: ['Corrida'],
          platforms: ['PC'],
          gameModes: ['Single Player'],
          engine: 'Unity',
          developmentStage: 'Conceito',
          ageRating: 'Livre (L)',
          languages: ['Português', 'Inglês'],
          trailerUrl: '',
          bannerUrl: PNG,
          logoUrl: PNG,
          thumbnailUrl: PNG,
        })
        .expect(201);
      gameId = body.id;
      expect(body).toMatchObject({
        genres: ['Racing', 'Action'],
        gameModes: ['SINGLE_PLAYER'],
        engine: 'UNITY',
        developmentStage: 'CONCEPT',
        ageRating: 'L',
        languages: ['pt-BR', 'en'],
        trailerUrl: null,
      });
      expect(body.bannerUrl).toContain(`/files/games/${gameId}/banner-`);
      expect(body.logoUrl).toContain(`/files/games/${gameId}/logo-`);

      await api()
        .put(`/api/games/${gameId}/access`)
        .set('Authorization', `Bearer ${estudio}`)
        .send({ entries: [{ groupId: 'group-qa', permissions: ['MANAGE_TESTS', 'VIEW_REPORTS'] }] })
        .expect(200);
      const catalogo = () => api().get('/api/games').set('Authorization', `Bearer ${jogador}`).expect(200);
      expect((await catalogo()).body.map((g: { id: string }) => g.id)).not.toContain(gameId);

      const finalizado = await api().post(`/api/games/${gameId}/finish-setup`).set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(finalizado.body).toMatchObject({ setupCompleted: true, status: 'ACTIVE' });
      // Finalizado, o jogo já aparece em "Jogos disponíveis" do jogador, mesmo sem teste.
      expect((await catalogo()).body.map((g: { id: string }) => g.id)).toContain(gameId);
      await api().get(`/api/player/games/${gameId}/tests`).set('Authorization', `Bearer ${jogador}`).expect(200);
    });

    it('sobe a build .zip sem versão e espera a validação', async () => {
      const { body } = await api()
        .post(`/api/games/${gameId}/builds`)
        .set('Authorization', `Bearer ${estudio}`)
        .attach('file', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('build de teste do e2e '.repeat(4096))]), 'corrida-2.1.0.zip')
        .expect(201);
      buildId = body.id;
      expect(body).toMatchObject({ version: '2.1.0', status: 'PROCESSING' });

      let status = body.status;
      for (let i = 0; i < 50 && status === 'PROCESSING'; i++) {
        await esperar(100);
        status = (await api().get(`/api/games/${gameId}/builds/${buildId}`).set('Authorization', `Bearer ${estudio}`).expect(200)).body.status;
      }
      expect(status).toBe('VALID');
    });

    it('cria o teste com lista, grade e envio de arquivo, paga e publica', async () => {
      const { body } = await api()
        .post('/api/tests')
        .set('Authorization', `Bearer ${estudio}`)
        .send({
          gameId,
          model: 'FREE_EXPLORATION',
          title: '',
          instructions: '',
          buildId,
          requiresController: true,
          questions: [
            { id: 'q-lista', type: 'DROPDOWN', label: 'Qual carro você usou?', required: true, options: ['Fusca', 'Opala'] },
            { id: 'q-grade', type: 'MULTIPLE_CHOICE_GRID', label: 'Como foi cada pista?', required: true, options: ['Terra', 'Asfalto'], columns: ['Ruim', 'Ótima'] },
            { id: 'q-print', type: 'FILE_UPLOAD', label: 'Mande um print do jogo', required: false },
            { id: 'q-texto', type: 'PARAGRAPH', label: 'Deixe o seu feedback', required: false },
          ],
          requiresRecording: false,
          requiresMicrophone: false,
          requiresWebcam: false,
          audience: { locations: ['GLOBAL'], playerType: 'ALL', archetype: 'ALL', minAge: 16, maxAge: 99 },
          budget: { slots: 3, untilDisabled: false, basePriceCents: 0, audienceCents: 0, boostCents: 0, pricePerTestCents: 0, totalCents: 0, rewardPerSessionCents: 200, durationDays: 7 },
        })
        .expect(201);
      testId = body.id;
      expect(body.title).toContain('Exploração livre');
      expect(body.requiresController).toBe(true);
      expect(body.questions[1].columns).toEqual(['Ruim', 'Ótima']);

      const pedido = await api().post(`/api/tests/${testId}/checkout`).set('Authorization', `Bearer ${estudio}`).send({ method: 'PIX' }).expect(201);
      expect(pedido.body.status).toBe('PAID');
    });

    it('recusa grade sem colunas', async () => {
      const { body } = await api()
        .post('/api/tests')
        .set('Authorization', `Bearer ${estudio}`)
        .send({
          gameId,
          model: 'FREE_EXPLORATION',
          title: '',
          instructions: '',
          buildId,
          questions: [{ id: 'q-1', type: 'CHECKBOX_GRID', label: 'Grade sem colunas', required: true, options: ['Linha'] }],
          requiresRecording: false,
          requiresMicrophone: false,
          requiresWebcam: false,
          audience: { locations: ['GLOBAL'], playerType: 'ALL', archetype: 'ALL', minAge: 16, maxAge: 99 },
          budget: { slots: 1, untilDisabled: false, basePriceCents: 0, audienceCents: 0, boostCents: 0, pricePerTestCents: 0, totalCents: 0, rewardPerSessionCents: 10, durationDays: 7 },
        })
        .expect(400);
      expect(body.fields).toHaveProperty(['questions.0.columns']);
    });

    it('o tester começa e baixa a build de verdade (com Range)', async () => {
      const conta = await api()
        .post('/api/auth/register')
        .send({ role: 'PLAYER', name: 'Tester do fluxo', email: `fluxo-${Date.now()}@teste.orbitplay.com`, password: 'Orbit#Teste-2026', birthDate: '2000-01-01', location: 'BRASIL' })
        .expect(201);
      tester = conta.body.token;

      const inicio = await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${tester}`).expect(201);
      participationId = inicio.body.id;

      const info = await api().get(`/api/player/tests/${testId}/build`).set('Authorization', `Bearer ${tester}`).expect(200);
      expect(info.body).toMatchObject({ fileName: 'corrida-2.1.0.zip', version: '2.1.0' });
      expect(info.body.sha256).toMatch(/^[a-f0-9]{64}$/);

      const arquivo = await api().get(`/api/player/tests/${testId}/build/file`).set('Authorization', `Bearer ${tester}`).buffer(true).expect(200);
      expect(Number(arquivo.headers['content-length'])).toBe('build de teste do e2e '.repeat(4096).length + 4);

      await api().get(`/api/player/tests/${testId}/build/file`).set('Authorization', `Bearer ${tester}`).set('Range', 'bytes=0-9').expect(206);
    });

    describe('O jogo aberto pelo app libera a avaliação (Tela 17)', () => {
      const jogo = (caminho: 'open' | 'heartbeat' | 'close', corpo?: object) =>
        api().post(`/api/player/participations/${participationId}/play/${caminho}`).set('Authorization', `Bearer ${tester}`).send(corpo).expect(200);
      const enviar = () =>
        api()
          .post(`/api/player/tests/${testId}/submit`)
          .set('Authorization', `Bearer ${tester}`)
          .send({ participationId, answers: { 'q-lista': 'Opala', 'q-grade': ['Terra: Ótima'] }, bugsReported: 0, durationSeconds: 600 });

      it('não abre antes de jogar', async () => {
        const revisao = await api().get(`/api/player/session-review?testId=${testId}`).set('Authorization', `Bearer ${tester}`).expect(200);
        // 60% dos 25 minutos estimados; o mínimo para avaliar é de 2 minutos.
        expect(revisao.body.play).toMatchObject({ outcome: 'NOT_OPENED', launches: 0, activeSeconds: 0, minSeconds: 120, targetSeconds: 900 });
        expect((await enviar().expect(409)).body.code).toBe('PLAY_TOO_SHORT');
      });

      it('abrir e fechar logo não conta o tempo que o app diz ter jogado', async () => {
        expect((await jogo('open')).body).toMatchObject({ launches: 1, playing: true });
        const { body } = await jogo('close', { activeSeconds: 3600, exitCode: 0 });
        expect(body).toMatchObject({ outcome: 'QUICK_EXIT', playing: false });
        expect(body.activeSeconds).toBeLessThan(10);
        expect((await enviar().expect(409)).body.code).toBe('PLAY_TOO_SHORT');
      });

      it('fechar logo com erro é travamento, não desistência', async () => {
        await jogo('open');
        // 0xC0000005 do Windows, em 32 bits com sinal.
        const { body } = await jogo('close', { activeSeconds: 1, exitCode: -1073741819 });
        expect(body).toMatchObject({ outcome: 'CRASHED', lastExitCode: -1073741819 });
      });

      it('batida sem o jogo aberto não conta', async () => {
        const { body } = await jogo('heartbeat', { activeSeconds: 30 });
        expect(body.activeSeconds).toBeLessThan(10);
      });

      it('jogar o tempo do teste conta, e a mesma batida não conta duas vezes', async () => {
        await jogo('open');
        // Só o relógio anda: o resto (timers do Express e do Prisma) segue real.
        jest.useFakeTimers({
          doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
        });
        try {
          jest.setSystemTime(Date.now() + 16 * 60_000);
          const primeira = await jogo('heartbeat', { activeSeconds: 960 });
          expect(primeira.body).toMatchObject({ outcome: 'COMPLETE', playing: true });
          const repetida = await jogo('heartbeat', { activeSeconds: 960 });
          expect(repetida.body.activeSeconds - primeira.body.activeSeconds).toBeLessThan(10);
          await jogo('close', { activeSeconds: 0, exitCode: 0 });
        } finally {
          jest.useRealTimers();
        }
      });
    });

    it('a avaliação traz as perguntas do estúdio e o envio grava grade e arquivo', async () => {
      const revisao = await api().get(`/api/player/session-review?testId=${testId}`).set('Authorization', `Bearer ${tester}`).expect(200);
      expect(revisao.body).toMatchObject({
        id: participationId,
        status: 'IN_PROGRESS',
        testId,
        requiresRecording: false,
        requiresMicrophone: false,
        requiresWebcam: false,
      });
      expect(revisao.body.questions.find((q: { id: string }) => q.id === 'q-grade').columns).toEqual(['Ruim', 'Ótima']);

      const resultado = await api()
        .post(`/api/player/tests/${testId}/submit`)
        .set('Authorization', `Bearer ${tester}`)
        .send({
          participationId,
          answers: { 'q-lista': 'Opala', 'q-grade': ['Terra: Ótima', 'Asfalto: Ruim'], 'q-print': PNG, 'q-texto': 'A curva do túnel é ótima.' },
          bugsReported: 0,
          durationSeconds: 30,
          formSeconds: 90,
        })
        .expect(201);
      expect(resultado.body.rewardStatus).toBe('PENDING');

      await api().get(`/api/player/session-outcome?testId=${testId}`).set('Authorization', `Bearer ${tester}`).expect(200);

      const respostas = await api().get(`/api/reports/${testId}/answers`).set('Authorization', `Bearer ${estudio}`).expect(200);
      const grade = respostas.body.questions.find((q: { id: string }) => q.id === 'q-grade');
      expect(grade.options).toContainEqual({ label: 'Terra: Ótima', count: 1 });
      const print = respostas.body.questions.find((q: { id: string }) => q.id === 'q-print');
      expect(print.texts[0].text).toContain(`/files/respostas/${participationId}/q-print-`);
    });

    it('desistir devolve a vaga e não deixa recomeçar', async () => {
      const conta = await api()
        .post('/api/auth/register')
        .send({ role: 'PLAYER', name: 'Tester que desiste', email: `desiste-${Date.now()}@teste.orbitplay.com`, password: 'Tester@2026x', birthDate: '2000-01-01', location: 'BRASIL' })
        .expect(201);
      const desistente = conta.body.token;
      const vagas = async () => (await api().get(`/api/tests/${testId}`).set('Authorization', `Bearer ${estudio}`).expect(200)).body.currentParticipants;

      await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${desistente}`).expect(201);
      const ocupadas = await vagas();
      const { body } = await api().post(`/api/player/tests/${testId}/abandon`).set('Authorization', `Bearer ${desistente}`).expect(200);
      expect(body.status).toBe('ABANDONED');
      expect(await vagas()).toBe(ocupadas - 1);

      await api().post(`/api/player/tests/${testId}/abandon`).set('Authorization', `Bearer ${desistente}`).expect(409);
      await api().post(`/api/player/tests/${testId}/start`).set('Authorization', `Bearer ${desistente}`).expect(409);
    });
  });

  describe('Gerenciamento de acessos (Figma 1273:3956 e 1276:5509)', () => {
    let pedro: string;
    let hideo: string;
    const sufixo = Date.now();

    beforeAll(async () => {
      [pedro, hideo] = await Promise.all([
        login('pedro-alves@estudio.orbitplay.com', 'STUDIO'),
        login('hideo-kojima@estudio.orbitplay.com', 'STUDIO'),
      ]);
    });

    it('lista usuários, grupos e o resumo', async () => {
      const { body } = await api().get('/api/studio/access').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body.summary.pendingInvites).toBeGreaterThanOrEqual(1);
      expect(body.users).toContainEqual(expect.objectContaining({ id: 'studio-001', admin: true, permissions: { manageUsers: true, deleteUsers: true } }));
      expect(body.users).toContainEqual(expect.objectContaining({ id: 'studio-hideo', admin: false, permissions: { manageUsers: true, deleteUsers: false } }));
      expect(body.groups.map((g: { name: string }) => g.name)).toEqual(expect.arrayContaining(['Diretores', 'QA', 'Analitics']));
    });

    it('a equipe resumida do Novo jogo', async () => {
      const { body } = await api().get('/api/studio/team').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body.groups).toContainEqual({ id: 'group-qa', name: 'QA', memberCount: 2 });
      expect(body.members.map((m: { id: string }) => m.id)).toContain('studio-hideo');
    });

    it('convida, ativa pela senha, suspende, restabelece e exclui', async () => {
      const email = `membro-${sufixo}@estudio.orbitplay.com`;
      const convite = await api().post('/api/studio/access/users').set('Authorization', `Bearer ${hideo}`).send({ email }).expect(201);
      expect(convite.body).toMatchObject({ email, status: 'PENDING', admin: false });
      const id = convite.body.id;

      await api().post('/api/studio/access/users').set('Authorization', `Bearer ${estudio}`).send({ email }).expect(409);

      // Só o ADM mexe nas colunas de permissão; quem não tem "Criar/Editar usuário" não mexe em nada.
      await api().patch(`/api/studio/access/users/${id}`).set('Authorization', `Bearer ${hideo}`).send({ permissions: { deleteUsers: true } }).expect(403);
      await api().patch(`/api/studio/access/users/${id}`).set('Authorization', `Bearer ${pedro}`).send({ status: 'INACTIVE' }).expect(403);
      const permissoes = await api()
        .patch(`/api/studio/access/users/${id}`)
        .set('Authorization', `Bearer ${estudio}`)
        .send({ permissions: { deleteUsers: true } })
        .expect(200);
      expect(permissoes.body.permissions).toEqual({ manageUsers: false, deleteUsers: true });

      await api().post(`/api/studio/access/users/${id}/password`).set('Authorization', `Bearer ${estudio}`).send({ password: 'fraca' }).expect(400);
      await api().post(`/api/studio/access/users/${id}/password`).set('Authorization', `Bearer ${estudio}`).send({ password: 'Membro@2026' }).expect(200);
      await api().post('/api/auth/login').send({ email, password: 'Membro@2026', role: 'STUDIO' }).expect(200);

      const suspenso = await api().patch(`/api/studio/access/users/${id}`).set('Authorization', `Bearer ${estudio}`).send({ status: 'INACTIVE' }).expect(200);
      expect(suspenso.body.status).toBe('INACTIVE');
      const barrado = await api().post('/api/auth/login').send({ email, password: 'Membro@2026', role: 'STUDIO' }).expect(403);
      expect(barrado.body.code).toBe('ACCOUNT_INACTIVE');

      await api().patch(`/api/studio/access/users/${id}`).set('Authorization', `Bearer ${estudio}`).send({ status: 'ACTIVE' }).expect(200);
      await api().post('/api/auth/login').send({ email, password: 'Membro@2026', role: 'STUDIO' }).expect(200);

      const excluido = await api().delete(`/api/studio/access/users/${id}`).set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(excluido.body).toEqual({ id });
      const lista = await api().get('/api/studio/access').set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(lista.body.users.some((u: { id: string }) => u.id === id)).toBe(false);
    });

    it('o administrador não é excluído', async () => {
      const { body } = await api().delete('/api/studio/access/users/studio-001').set('Authorization', `Bearer ${estudio}`).expect(409);
      expect(body.code).toBe('ADMIN');
    });

    it('cria, preenche, renomeia e exclui grupo', async () => {
      const criado = await api().post('/api/studio/access/groups').set('Authorization', `Bearer ${estudio}`).send({ name: `Grupo ${sufixo}`, memberIds: [] }).expect(201);
      expect(criado.body).toMatchObject({ status: 'INACTIVE', members: [] });
      const id = criado.body.id;

      const cheio = await api().patch(`/api/studio/access/groups/${id}`).set('Authorization', `Bearer ${estudio}`).send({ memberIds: ['studio-pedro'] }).expect(200);
      expect(cheio.body).toMatchObject({ status: 'ACTIVE', members: [expect.objectContaining({ id: 'studio-pedro' })] });

      const renomeado = await api().patch(`/api/studio/access/groups/${id}`).set('Authorization', `Bearer ${estudio}`).send({ name: `Renomeado ${sufixo}` }).expect(200);
      expect(renomeado.body.name).toBe(`Renomeado ${sufixo}`);

      const { body } = await api().delete(`/api/studio/access/groups/${id}`).set('Authorization', `Bearer ${estudio}`).expect(200);
      expect(body).toEqual({ id });
    });

    it('é só do estúdio', () => api().get('/api/studio/access').set('Authorization', `Bearer ${jogador}`).expect(403));
  });

  describe('Central de usuários (Tela 20)', () => {
    it('é só da administração', () => api().get('/api/admin/users').set('Authorization', `Bearer ${estudio}`).expect(403));

    it('lista para o Owner', async () => {
      const { body } = await api().get('/api/admin/users?search=orbitplay').set('Authorization', `Bearer ${owner}`).expect(200);
      expect(body.length).toBeGreaterThan(0);
    });

    it('não deixa a plataforma sem Owner', async () => {
      const { body } = await api()
        .patch('/api/admin/users/owner-001/role')
        .set('Authorization', `Bearer ${owner}`)
        .send({ role: 'ADMIN' })
        .expect(422);
      expect(body.code).toBe('LAST_OWNER');
    });
  });
  describe('Carteira e saque simulado (Tela 13)', () => {
    let token: string;
    let userId: string;
    const prisma = () => app.get(PrismaService);
    const carteira = async () =>
      (await api().get('/api/player/wallet').set('Authorization', `Bearer ${token}`).expect(200)).body;
    const sacar = (corpo: object, chave = `saque-${Date.now()}-${Math.random()}`) =>
      api().post('/api/player/withdrawals').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', chave).send(corpo);
    const pixValido = '123.456.789-09';

    beforeAll(async () => {
      const email = `saque-${Date.now()}@teste.orbitplay.com`;
      const conta = await api()
        .post('/api/auth/register')
        .send({ role: 'PLAYER', name: 'Tester do saque', email, password: 'Tester@2026x', birthDate: '2000-01-01', location: 'BRASIL' })
        .expect(201);
      token = conta.body.token;
      userId = (await prisma().user.findUniqueOrThrow({ where: { email } })).id;
      await prisma().playerProfile.update({ where: { userId }, data: { balanceCents: 150_000 } });
    });

    it('recusa chave que não é Pix', async () => {
      const { body } = await sacar({ amountCents: 2000, pixKey: 'minha chave' }).expect(400);
      expect(body.fields.pixKey).toMatch(/chave Pix válida/);
    });

    it('recusa valor acima do saldo sem mexer no saldo', async () => {
      const antes = (await carteira()).balanceCents;
      const { body } = await sacar({ amountCents: antes + 1, pixKey: pixValido }).expect(422);
      expect(body.code).toBe('WITHDRAWAL_BLOCKED');
      expect((await carteira()).balanceCents).toBe(antes);
    });

    it('o saque sai do saldo na hora, mascara a chave e fica em análise', async () => {
      const antes = await carteira();
      expect(antes.dailyLimitCents).toBe(100_000);
      const { body } = await sacar({ amountCents: 5000, pixKey: pixValido }).expect(201);
      expect(body).toMatchObject({ amountCents: 5000, status: 'REQUESTED', pixKey: '•••8909' });

      const depois = await carteira();
      expect(depois.balanceCents).toBe(antes.balanceCents - 5000);
      expect(depois.canWithdraw).toBe(false);
      expect(depois.withdrawBlockedReason).toBe('Já existe um saque em análise.');
      expect(depois.transactions[0]).toMatchObject({ type: 'WITHDRAWAL', amountCents: -5000 });
    });

    it('não deixa pedir outro saque enquanto um está em análise', async () => {
      const { body } = await sacar({ amountCents: 2000, pixKey: pixValido }).expect(422);
      expect(body.code).toBe('WITHDRAWAL_BLOCKED');
    });

    it('o Pix simulado paga o saque em análise e avisa o tester', async () => {
      expect(await app.get(WithdrawalSettlementService).settleDue(0)).toBeGreaterThanOrEqual(1);

      const saques = (await carteira()).withdrawals;
      expect(saques[0]).toMatchObject({ amountCents: 5000, status: 'PAID' });
      expect(saques[0].note).toMatch(/simulado/i);
      expect((await carteira()).canWithdraw).toBe(true);

      const avisos = await api().get('/api/notifications').set('Authorization', `Bearer ${token}`).expect(200);
      expect(JSON.stringify(avisos.body)).toContain('Saque pago!');
      // Pagar de novo não debita nem paga duas vezes.
      expect(await app.get(WithdrawalSettlementService).settleDue(0)).toBe(0);
    });

    it('a Central ainda pode recusar um saque e o valor volta para o saldo', async () => {
      const antes = (await carteira()).balanceCents;
      const { body: saque } = await sacar({ amountCents: 3000, pixKey: 'tester@teste.orbitplay.com' }).expect(201);
      await api()
        .patch(`/api/admin/withdrawals/${saque.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ status: 'REJECTED', note: 'Chave não confere.' })
        .expect(200);
      expect((await carteira()).balanceCents).toBe(antes);
    });

    it('barra o saque que estoura o teto de 24 horas, somando os anteriores', async () => {
      await prisma().playerProfile.update({ where: { userId }, data: { balanceCents: 500_000 } });
      const { body } = await sacar({ amountCents: 100_000, pixKey: pixValido }).expect(422);
      expect(body.message).toMatch(/limite de saque/i);
    });

    it('repetir a mesma Idempotency-Key não saca duas vezes', async () => {
      await prisma().withdrawal.updateMany({ where: { playerId: userId, status: 'REQUESTED' }, data: { status: 'PAID' } });
      await prisma().withdrawal.deleteMany({ where: { playerId: userId } });
      const antes = (await carteira()).balanceCents;
      const chave = `repetida-${Date.now()}`;
      const primeiro = await sacar({ amountCents: 2000, pixKey: pixValido }, chave).expect(201);
      const segundo = await sacar({ amountCents: 2000, pixKey: pixValido }, chave);
      expect(segundo.body.id).toBe(primeiro.body.id);
      expect((await carteira()).balanceCents).toBe(antes - 2000);
    });

    it('estúdio não acessa a carteira do tester', async () => {
      await api().get('/api/player/wallet').set('Authorization', `Bearer ${estudio}`).expect(403);
    });
  });
});
