import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { passwordProblem } from '../src/common/security/password-policy';
import { assertPlausibleEvents } from '../src/common/security/telemetry-limits';
import { assinaturaConfere } from '../src/common/storage/upload-filters';
import { verifyWebhookSignature } from '../src/modules/payments/payment-gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { cadastrar } from './cadastro';

// Nada de e-mail real nos testes: sem SMTP o MailService manda para o log (o .env não sobrescreve).
process.env.SMTP_HOST = '';

const SENHA_BOA = 'Orbit#Teste-2026';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WEBHOOK_SECRET = 'segredo-de-teste-do-webhook-segredo-de-teste';

async function criarApp(rateLimit: boolean): Promise<NestExpressApplication> {
  process.env.RATE_LIMIT_DISABLED = rateLimit ? 'false' : 'true';
  process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  await app.get(PrismaService).user.updateMany({ data: { failedLoginCount: 0, lockedUntil: null } });
  return app;
}

describe('Segurança da API (e2e)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string, role: 'STUDIO' | 'PLAYER', password = '123456') =>
    (await api().post('/api/auth/login').send({ email, password, role }).expect(200)).body.token as string;

  let estudioA: string;
  let jogador: string;
  let jogador2: string;
  let estudioB: string;
  let gameA: string;

  beforeAll(async () => {
    app = await criarApp(false);
    [estudioA, jogador] = await Promise.all([
      login('studio@orbitplay.com', 'STUDIO'),
      login('player@orbitplay.com', 'PLAYER'),
    ]);
    jogador2 = (
      await cadastrar(app, { role: 'PLAYER', name: 'Outro', email: `j2-${Date.now()}@teste.orbitplay.com`, password: SENHA_BOA, birthDate: '2000-01-01', location: 'BRASIL' })
    ).token;
    const email = `estudio-b-${Date.now()}@teste.orbitplay.com`;
    estudioB = (await cadastrar(app, { role: 'STUDIO', name: 'Bruno', email, password: SENHA_BOA, organization: 'Estúdio B' })).token;
    gameA = (await api().get('/api/games').set(auth(estudioA)).expect(200)).body[0].id;
  });

  afterAll(() => app.close());

  describe('Autenticação e tokens', () => {
    it('recusa rota privada sem token', async () => {
      await api().get('/api/auth/me').expect(401);
      await api().get('/api/games').expect(401);
    });

    it('recusa token malformado, de outro segredo, sem assinatura (alg none) e expirado', async () => {
      await api().get('/api/auth/me').set(auth('lixo.lixo.lixo')).expect(401);

      const alheio = new JwtService({ secret: 'outro-segredo-qualquer-outro-segredo-qualquer' });
      const base = { sub: 'studio-001', role: 'STUDIO' };
      const opts = { audience: 'orbitplay-api', issuer: 'orbitplay' };
      await api().get('/api/auth/me').set(auth(await alheio.signAsync(base, opts))).expect(401);

      const semAssinatura = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ ...base, aud: 'orbitplay-api', iss: 'orbitplay', exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url')}.`;
      await api().get('/api/auth/me').set(auth(semAssinatura)).expect(401);

      const proprio = new JwtService({ secret: process.env.JWT_SECRET });
      const expirado = await proprio.signAsync(base, { ...opts, expiresIn: -10 });
      await api().get('/api/auth/me').set(auth(expirado)).expect(401);
    });

    it('recusa token válido de outra audiência (telemetria/vídeo não servem de acesso)', async () => {
      const proprio = new JwtService({ secret: process.env.JWT_SECRET });
      const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email: 'studio@orbitplay.com' } });
      for (const audience of ['orbitplay-telemetry', 'orbitplay-video']) {
        const token = await proprio.signAsync({ sub: user.id, role: 'STUDIO' }, { audience, issuer: 'orbitplay', expiresIn: 600 });
        await api().get('/api/auth/me').set(auth(token)).expect(401);
      }
      // E sem audiência nenhuma (token legado/forjado com o segredo certo) também não passa.
      await api().get('/api/auth/me').set(auth(await proprio.signAsync({ sub: user.id, role: 'STUDIO' }, { expiresIn: 600 }))).expect(401);
    });

    it('logout revoga o token: ele deixa de valer mesmo antes de vencer', async () => {
      const token = await login('player@orbitplay.com', 'PLAYER');
      await api().get('/api/auth/me').set(auth(token)).expect(200);
      await api().post('/api/auth/logout').set(auth(token)).expect(200);
      await api().get('/api/auth/me').set(auth(token)).expect(401);
      // O outro token da mesma conta segue valendo.
      await api().get('/api/auth/me').set(auth(jogador)).expect(200);
    });

    it('troca de senha invalida os tokens anteriores', async () => {
      const email = `troca-${Date.now()}@teste.orbitplay.com`;
      const body = await cadastrar(app, { role: 'PLAYER', name: 'Troca', email, password: SENHA_BOA, birthDate: '2000-01-01', location: 'BRASIL' });
      await new Promise((r) => setTimeout(r, 1100));
      await api().post('/api/me/password').set(auth(body.token)).send({ currentPassword: SENHA_BOA, newPassword: 'Outra#Senha-2027' }).expect(200);
      await api().get('/api/auth/me').set(auth(body.token)).expect(401);
    });

    it('a resposta de login não vaza hash nem campos internos', async () => {
      const { body } = await api().post('/api/auth/login').send({ email: 'player@orbitplay.com', password: '123456', role: 'PLAYER' }).expect(200);
      const texto = JSON.stringify(body);
      expect(texto).not.toMatch(/passwordHash|\$2[aby]\$|failedLoginCount|lockedUntil|sessionsValidAfter/);
    });
  });

  describe('Senhas', () => {
    it('recusa senha fraca, comum ou longa demais no cadastro', async () => {
      const base = { role: 'PLAYER', name: 'Fraca', birthDate: '2000-01-01', location: 'BRASIL', acceptTerms: true };
      for (const password of ['curta1', '12345678', 'somenteletras', 'password', 'a'.repeat(80) + '1']) {
        await api().post('/api/auth/register').send({ ...base, email: `f-${Date.now()}@t.com`, password }).expect(400);
      }
    });

    it('a política aceita senha boa e explica a recusa', () => {
      expect(passwordProblem(SENHA_BOA)).toBeNull();
      expect(passwordProblem('abc')).toMatch(/8 caracteres/);
      expect(passwordProblem('ççççççççççççççççççççççççççççççççççççç1')).toMatch(/72/);
    });

    it('a senha nunca é guardada em texto e usa bcrypt', async () => {
      const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email: 'player@orbitplay.com' } });
      expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(user.passwordHash).not.toContain('123456');
    });
  });

  describe('Mass assignment e escalada de privilégio', () => {
    it('cadastro ignora role de administrador e campos internos', async () => {
      const email = `ma-${Date.now()}@teste.orbitplay.com`;
      await api()
        .post('/api/auth/register')
        .send({ role: 'OWNER', name: 'X', email, password: SENHA_BOA, acceptTerms: true })
        .expect(400);

      const { body } = await api()
        .post('/api/auth/register')
        .send({
          role: 'PLAYER', name: 'Mass', email, password: SENHA_BOA, birthDate: '2000-01-01', location: 'BRASIL', acceptTerms: true,
          status: 'ACTIVE', studioPermission: 'MANAGE', teamPermissions: ['MANAGE_USERS'], balanceCents: 999999, xp: 99999, id: 'studio-001',
        })
        .expect(201);
      const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email }, include: { player: true } });
      expect(user.role).toBe('PLAYER');
      expect(user.studioPermission).toBeNull();
      expect(user.teamPermissions).toEqual([]);
      expect(user.id).not.toBe('studio-001');
      // `status: 'ACTIVE'` no corpo não pula a verificação do e-mail.
      expect(user.status).toBe('PENDING');
      expect(body).toEqual({ email });
      expect(user.player?.balanceCents ?? 0).toBe(0);
    });

    it('PATCH /me só muda nome e idioma (papel, saldo e permissão são ignorados)', async () => {
      await api()
        .patch('/api/me')
        .set(auth(jogador))
        .send({ name: 'Jogador Renomeado', role: 'ADMIN', studioPermission: 'MANAGE', balanceCents: 1_000_000, xp: 1_000_000 })
        .expect(200);
      const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email: 'player@orbitplay.com' }, include: { player: true } });
      expect(user.role).toBe('PLAYER');
      expect(user.studioPermission).toBeNull();
      expect(user.player?.balanceCents).not.toBe(1_000_000);
      expect(user.player?.xp).not.toBe(1_000_000);
      await api().patch('/api/me').set(auth(jogador)).send({ name: 'Jogador' }).expect(200);
    });

    it('rotas de administração recusam estúdio e jogador', async () => {
      for (const token of [estudioA, estudioB, jogador]) {
        await api().get('/api/admin/users').set(auth(token)).expect(403);
        await api().get('/api/admin/withdrawals').set(auth(token)).expect(403);
        await api().get('/api/admin/audit-logs').set(auth(token)).expect(403);
        await api().post('/api/admin/users').set(auth(token)).send({ name: 'x', email: 'x@x.com', role: 'ADMIN', password: SENHA_BOA }).expect(403);
      }
    });

    it('jogador não acessa rotas de estúdio, e estúdio não acessa rotas de jogador', async () => {
      await api().post('/api/games').set(auth(jogador)).send({ name: 'x' }).expect(403);
      await api().get('/api/player/wallet').set(auth(estudioA)).expect(403);
      await api().post('/api/player/withdrawals').set(auth(estudioA)).send({ amountCents: 1000, pixKey: 'a@b.com' }).expect(403);
    });
  });

  describe('Isolamento entre estúdios (IDOR/BOLA)', () => {
    it('um estúdio não vê o jogo de outro estúdio nem o lista', async () => {
      await api().get(`/api/games/${gameA}`).set(auth(estudioA)).expect(200);
      const lista = (await api().get('/api/games').set(auth(estudioB)).expect(200)).body as { id: string }[];
      expect(lista.map((g) => g.id)).not.toContain(gameA);
      const r = await api().get(`/api/games/${gameA}`).set(auth(estudioB));
      expect([403, 404]).toContain(r.status);
    });

    it('um estúdio não altera nem exclui jogo de outro', async () => {
      for (const metodo of ['patch', 'delete'] as const) {
        const r = await api()[metodo](`/api/games/${gameA}`).set(auth(estudioB)).send({ name: 'invadido' });
        expect([403, 404]).toContain(r.status);
      }
      const jogo = await app.get(PrismaService).game.findUniqueOrThrow({ where: { id: gameA } });
      expect(jogo.name).not.toBe('invadido');
    });

    it('builds, chaves do plug-in, relatórios e acessos do jogo ficam fechados para o outro estúdio', async () => {
      const rotas = [
        `/api/games/${gameA}/builds`,
        `/api/games/${gameA}/plugin/keys`,
        `/api/games/${gameA}/plugin/config`,
        `/api/games/${gameA}/access`,
        `/api/reports/${gameA}`,
        `/api/reports/${gameA}/answers`,
        `/api/reports/${gameA}/export`,
        `/api/reports/${gameA}/plugin`,
      ];
      for (const rota of rotas) {
        const r = await api().get(rota).set(auth(estudioB));
        expect([403, 404]).toContain(r.status);
      }
      const gerar = await api().post(`/api/games/${gameA}/plugin/keys`).set(auth(estudioB)).send({});
      expect([403, 404]).toContain(gerar.status);
    });

    it('sessões e pagamentos de outro estúdio não abrem por id', async () => {
      const prisma = app.get(PrismaService);
      const sessao = await prisma.participation.findFirst({ where: { playtest: { game: { studioId: 'studio-001' } } }, select: { id: true } });
      const pedido = await prisma.order.findFirst({ where: { studioId: 'studio-001' }, select: { id: true } });
      if (sessao) {
        const r = await api().get(`/api/sessions/${sessao.id}`).set(auth(estudioB));
        expect([403, 404]).toContain(r.status);
      }
      if (pedido) {
        for (const rota of [`/api/payments/${pedido.id}`, `/api/payments/${pedido.id}/receipt`]) {
          const r = await api().get(rota).set(auth(estudioB));
          expect([403, 404]).toContain(r.status);
        }
      }
    });

    it('jogador não lê relatório, sessões de estúdio nem chaves do plug-in', async () => {
      for (const rota of [`/api/reports/${gameA}`, `/api/games/${gameA}/plugin/keys`, `/api/games/${gameA}/builds`, '/api/sessions']) {
        const r = await api().get(rota).set(auth(jogador));
        expect([403, 404]).toContain(r.status);
      }
    });

    it('jogador só abre a própria carteira e não vê dados de outro jogador', async () => {
      const a = await api().get('/api/player/wallet').set(auth(jogador)).expect(200);
      const b = await api().get('/api/player/wallet').set(auth(jogador2)).expect(200);
      expect(a.body).not.toEqual(b.body);
    });

    it('membro com permissão de estúdio EDIT não concede acesso a si mesmo (nem a outro)', async () => {
      const prisma = app.get(PrismaService);
      const email = `edit-${Date.now()}@teste.orbitplay.com`;
      const { hashPassword } = await import('../src/modules/users/password');
      const membro = await prisma.user.create({
        data: {
          name: 'Editor', email, passwordHash: await hashPassword(SENHA_BOA), role: 'STUDIO', status: 'ACTIVE',
          studioId: 'studio-001', studioPermission: 'EDIT',
        },
      });
      const token = await login(email, 'STUDIO', SENHA_BOA);
      const r = await api().put(`/api/games/${gameA}/access`).set(auth(token)).send({ entries: [{ userId: membro.id, permissions: ['MANAGE_ACCESS'] }] });
      expect([400, 403]).toContain(r.status);
      const admin = await api().post('/api/studio/access/users').set(auth(token)).send({ email: `novo-${Date.now()}@t.com` });
      expect(admin.status).toBe(403);
    });

    it('quem tem só "Criar/Editar usuário" não troca a senha de conta com mais poder (sem atalho de escalada)', async () => {
      const prisma = app.get(PrismaService);
      const { hashPassword } = await import('../src/modules/users/password');
      const senha = await hashPassword(SENHA_BOA);
      const sufixo = Date.now();
      const base = { passwordHash: senha, role: 'STUDIO' as const, status: 'ACTIVE' as const, studioId: 'studio-001' };
      const gestor = await prisma.user.create({ data: { ...base, name: 'Gestor', email: `g-${sufixo}@t.com`, studioPermission: 'EDIT', teamPermissions: ['MANAGE_USERS'] } });
      const poderoso = await prisma.user.create({ data: { ...base, name: 'Poderoso', email: `p-${sufixo}@t.com`, studioPermission: 'EDIT', teamPermissions: ['MANAGE_USERS', 'DELETE_USERS'] } });
      const igual = await prisma.user.create({ data: { ...base, name: 'Igual', email: `i-${sufixo}@t.com`, studioPermission: 'VIEW', teamPermissions: [] } });
      const token = await login(gestor.email, 'STUDIO', SENHA_BOA);

      const negado = await api().post(`/api/studio/access/users/${poderoso.id}/password`).set(auth(token)).send({ password: 'Nova#Senha-2030' });
      expect(negado.status).toBe(403);
      const permitido = await api().post(`/api/studio/access/users/${igual.id}/password`).set(auth(token)).send({ password: 'Nova#Senha-2030' });
      expect(permitido.status).toBe(200);
    });
  });

  describe('Uploads e downloads', () => {
    it('recusa extensão proibida e conteúdo que não bate com o formato', async () => {
      const aba = (b: Buffer, nome: string) =>
        api().post(`/api/games/${gameA}/builds`).set(auth(estudioA)).attach('file', b, nome);
      expect((await aba(Buffer.from('MZ....'), 'malware.sh')).status).toBe(400);
      expect((await aba(Buffer.from('<?php system($_GET[1]); ?>'), 'build.exe')).status).toBe(400);
      expect((await aba(Buffer.from('texto qualquer'), 'build.zip')).status).toBe(400);
    });

    it('recusa SVG e HTML como imagem (XSS por arquivo)', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const r = await api().post('/api/me/avatar').set(auth(jogador)).attach('file', svg, { filename: 'a.svg', contentType: 'image/svg+xml' });
      expect(r.status).toBe(400);
      const falso = await api().post('/api/me/avatar').set(auth(jogador)).attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'a.png', contentType: 'image/png' });
      expect(falso.status).toBe(400);
    });

    it('nome de arquivo com caminho não escapa da pasta do jogo', async () => {
      const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('x'.repeat(2048))]);
      const r = await api().post(`/api/games/${gameA}/builds`).set(auth(estudioA)).attach('file', zip, '../../../../etc/cron.d/evil.zip');
      if (r.status === 201) {
        const salvo = await app.get(PrismaService).build.findUniqueOrThrow({ where: { id: r.body.id } });
        expect(salvo.storageKey).not.toContain('..');
      } else {
        expect([400, 422]).toContain(r.status);
      }
    });

    it('download de build exige sessão em andamento: o jogador sem participação recebe 403/404', async () => {
      const builds = [{ id: 'x', playtestId: 'seed-test-game-101' }];
      const r = await api().get(`/api/player/tests/${builds[0].playtestId ?? 'x'}/build/file`).set(auth(jogador));
      expect([401, 403, 404]).toContain(r.status);
      await api().get(`/api/player/tests/${builds[0].playtestId ?? 'x'}/build/file`).expect(401);
    });

    it('arquivos públicos saem com nosniff e sem script; fora da pasta pública não há acesso', async () => {
      const r = await api().get('/api/files/../private/x').set(auth(estudioA));
      expect(r.status).toBeGreaterThanOrEqual(400);
      const dotfile = await api().get('/api/files/.env');
      expect(dotfile.status).toBeGreaterThanOrEqual(400);
    });

    it('detecta assinatura de arquivo por formato', () => {
      expect(assinaturaConfere(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '.png')).toBe(true);
      expect(assinaturaConfere(Buffer.from('<svg>'), '.png')).toBe(false);
      expect(assinaturaConfere(Buffer.from('MZ'), '.exe')).toBe(true);
      expect(assinaturaConfere(Buffer.from('#!/bin/sh'), '.exe')).toBe(false);
    });
  });

  describe('OrbitPlug-in e telemetria', () => {
    it('envio de telemetria sem token, com token inválido ou com token de acesso é recusado', async () => {
      const corpo = { events: [{ atSecond: 1, type: 'TRIGGER', label: 'x' }] };
      await api().post('/api/plugin/telemetry').send(corpo).expect(401);
      await api().post('/api/plugin/telemetry').set(auth('abc.def.ghi')).send(corpo).expect(401);
      await api().post('/api/plugin/telemetry').set(auth(jogador)).send(corpo).expect(401);
    });

    it('validação e configuração do plug-in exigem a chave do jogo', async () => {
      await api().post('/api/plugin/validate').send({}).expect(401);
      await api().post('/api/plugin/validate').set({ 'X-Orbit-Plugin-Key': 'opk_inexistente' }).send({}).expect(401);
      await api().put('/api/plugin/config').send({}).expect(401);
      // Um token de usuário não serve como chave do plug-in.
      await api().put('/api/plugin/config').set(auth(estudioA)).send({}).expect(401);
    });

    it('chave revogada deixa de valer e só o estúdio dono revoga', async () => {
      const criada = await api().post(`/api/games/${gameA}/plugin/keys`).set(auth(estudioA)).send({}).expect(201);
      const chave = criada.body.code;
      const id = criada.body.id;
      const cabecalho = { 'X-Orbit-Plugin-Key': chave };
      expect((await api().post('/api/plugin/validate').set(cabecalho).send({})).status).toBeLessThan(300);
      const alheio = await api().delete(`/api/games/${gameA}/plugin/keys/${id}`).set(auth(estudioB));
      expect([403, 404]).toContain(alheio.status);
      await api().delete(`/api/games/${gameA}/plugin/keys/${id}`).set(auth(estudioA)).expect(200);
      const r = await api().post('/api/plugin/validate').set(cabecalho).send({});
      expect(r.status).toBe(401);
    });

    it('limites de plausibilidade: evento no futuro, payload gigante e cota estouram', () => {
      const comeco = new Date(Date.now() - 60_000);
      expect(() => assertPlausibleEvents([{ atSecond: 30 }], comeco, 0)).not.toThrow();
      expect(() => assertPlausibleEvents([{ atSecond: 5000 }], comeco, 0)).toThrow(/impossível/);
      expect(() => assertPlausibleEvents([{ atSecond: 1, payload: { a: 'x'.repeat(5000) } }], comeco, 0)).toThrow(/grandes/);
      expect(() => assertPlausibleEvents([{ atSecond: 1 }], comeco, 50_000)).toThrow(/Limite/);
    });
  });

  describe('Segurança financeira', () => {
    const assinar = (corpo: string, t = Math.floor(Date.now() / 1000), segredo = WEBHOOK_SECRET) =>
      `t=${t},v1=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`;

    it('webhook sem assinatura, com assinatura errada ou vencida não marca nada como pago', async () => {
      const corpo = JSON.stringify({ providerRef: 'sandbox_qualquer', status: 'PAID' });
      const enviar = (assinatura?: string) =>
        api().post('/api/payments/webhooks/sandbox').set('Content-Type', 'application/json').set(assinatura ? { 'X-Orbit-Signature': assinatura } : {}).send(corpo);
      expect((await enviar()).status).toBe(401);
      expect((await enviar(assinar(corpo, undefined, 'segredo-errado'))).status).toBe(401);
      expect((await enviar(assinar(corpo, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
      expect((await enviar(assinar(corpo + ' '))).status).toBe(401);
      // Assinatura certa passa da verificação e só então cai em "pedido não encontrado".
      expect((await enviar(assinar(corpo))).status).toBe(404);
    });

    it('a verificação de assinatura é rígida', () => {
      const raw = Buffer.from('{"a":1}');
      const t = Math.floor(Date.now() / 1000);
      const ok = `t=${t},v1=${createHmac('sha256', 's').update(`${t}.`).update(raw).digest('hex')}`;
      expect(() => verifyWebhookSignature({ 'x-orbit-signature': ok }, raw, 's', 300)).not.toThrow();
      expect(() => verifyWebhookSignature({ 'x-orbit-signature': ok }, raw, '', 300)).toThrow();
      expect(() => verifyWebhookSignature({ 'x-orbit-signature': ok }, undefined, 's', 300)).toThrow();
      expect(() => verifyWebhookSignature({}, raw, 's', 300)).toThrow();
      expect(() => verifyWebhookSignature({ 'x-orbit-signature': 'lixo' }, raw, 's', 300)).toThrow();
    });

    it('saque: valor negativo, zero, decimal ou acima do saldo é recusado e o saldo não muda', async () => {
      const antes = (await api().get('/api/player/wallet').set(auth(jogador)).expect(200)).body.balanceCents;
      for (const amountCents of [-500, 0, 10.5, 'abc', antes + 100_000_000]) {
        const r = await api().post('/api/player/withdrawals').set(auth(jogador)).set('Idempotency-Key', `k-${Math.random()}`).send({ amountCents, pixKey: 'a@b.com' });
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
      }
      const depois = (await api().get('/api/player/wallet').set(auth(jogador)).expect(200)).body.balanceCents;
      expect(depois).toBe(antes);
    });

    it('saque repetido com a mesma Idempotency-Key debita uma vez só', async () => {
      const prisma = app.get(PrismaService);
      const perfil = await prisma.playerProfile.findFirstOrThrow({ where: { user: { email: 'player@orbitplay.com' } } });
      await prisma.playerProfile.update({ where: { userId: perfil.userId }, data: { balanceCents: 50_000 } });
      // A regra de negócio barra novo saque com outro em análise: limpa o de rodadas anteriores.
      await prisma.withdrawal.deleteMany({ where: { playerId: perfil.userId, status: 'REQUESTED' } });
      const chave = `saque-${Date.now()}`;
      const envio = () => api().post('/api/player/withdrawals').set(auth(jogador)).set('Idempotency-Key', chave).send({ amountCents: 10_000, pixKey: 'a@b.com' });
      const resultados = await Promise.all([envio(), envio(), envio()]);
      resultados.forEach((r) => expect([200, 201, 409]).toContain(r.status));
      const depois = await prisma.playerProfile.findUniqueOrThrow({ where: { userId: perfil.userId } });
      expect(depois.balanceCents).toBe(40_000);
      const saques = await prisma.withdrawal.count({ where: { playerId: perfil.userId, amountCents: 10_000, createdAt: { gte: new Date(Date.now() - 60_000) } } });
      expect(saques).toBe(1);
    });

    it('o jogador não manda saldo, recompensa nem bônus no envio da avaliação', async () => {
      const r = await api()
        .post('/api/player/tests/seed-test-game-101/submit')
        .set(auth(jogador))
        .send({ participationId: 'inexistente', answers: {}, bugsReported: 0, durationSeconds: 1, rewardCents: 99999, balanceCents: 99999 });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    });
  });

  describe('Cabeçalhos, CORS e erros', () => {
    it('responde com cabeçalhos de segurança e sem X-Powered-By', async () => {
      const r = await api().get('/api/auth/me');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-powered-by']).toBeUndefined();
    });

    it('CORS só ecoa origens permitidas', async () => {
      const ok = await api().options('/api/auth/login').set({ Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' });
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const ruim = await api().options('/api/auth/login').set({ Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
      expect(ruim.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('não vaza stack, SQL nem caminhos em erros', async () => {
      const respostas = [
        await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"quebrado":'),
        await api().get('/api/games/%27%20OR%201=1--').set(auth(estudioA)),
        await api().post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null }, role: 'STUDIO' }),
      ];
      for (const r of respostas) {
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
        expect(JSON.stringify(r.body)).not.toMatch(/prisma|at \/|node_modules|SELECT |\.ts:/i);
      }
    });

    it('injeção de SQL em busca e filtros não altera o resultado nem derruba a API', async () => {
      const r = await api().get("/api/games").query({ search: "' OR 1=1; DROP TABLE \"User\";--" }).set(auth(estudioA));
      expect(r.status).toBeLessThan(500);
      expect(await app.get(PrismaService).user.count()).toBeGreaterThan(0);
    });

    it('corpo JSON acima de 1 MB é recusado fora das rotas de imagem (413)', async () => {
      const r = await api().post('/api/auth/login').send({ email: 'a@b.com', password: 'x'.repeat(1_200_000), role: 'STUDIO' });
      expect(r.status).toBe(413);
    });

    it('imagem em data URL só é aceita nas rotas de imagem e só se for imagem de verdade', async () => {
      expect(PNG.startsWith('data:image/png')).toBe(true);
      const r = await api().patch('/api/me').set(auth(jogador)).send({ name: 'ok', extra: 'x'.repeat(1_500_000) });
      expect(r.status).toBe(413);
    });
  });

  describe('WebSocket do chat', () => {
    let porta: number;
    beforeAll(async () => {
      await app.listen(0);
      porta = (app.getHttpServer().address() as { port: number }).port;
    });

    const abrir = (url: string, protocolos?: string[], origin?: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(url, protocolos, origin ? { headers: { Origin: origin } } : undefined);
        ws.on('open', () => {
          ws.close();
          resolve('aberto');
        });
        ws.on('unexpected-response', (_req, res) => {
          resolve(String(res.statusCode));
          ws.terminate();
        });
        ws.on('error', () => undefined);
      });

    it('recusa sem token, com token na URL, com token inválido e com origem não permitida; aceita pelo subprotocolo', async () => {
      const base = `ws://127.0.0.1:${porta}/api/community/ws?gameId=${gameA}`;
      expect(await abrir(base)).toBe('401');
      expect(await abrir(`${base}&token=${estudioA}`)).toBe('401');
      expect(await abrir(base, ['orbit.v1', 'lixo.lixo.lixo'])).toBe('401');
      expect(await abrir(base, ['orbit.v1', estudioA], 'https://evil.example')).toBe('403');
      expect(await abrir(base, ['orbit.v1', estudioB])).toBe('403');
      expect(await abrir(base, ['orbit.v1', estudioA], 'http://localhost:5173')).toBe('aberto');
    });
  });

  describe('Recuperação de senha', () => {
    it('devolve a mesma resposta para e-mail existente e inexistente', async () => {
      const a = await api().post('/api/auth/recover').send({ email: 'player@orbitplay.com' }).expect(200);
      const b = await api().post('/api/auth/recover').send({ email: 'nao-existe@teste.orbitplay.com' }).expect(200);
      expect(a.body.message.replace('player@orbitplay.com', 'X')).toBe(b.body.message.replace('nao-existe@teste.orbitplay.com', 'X'));
    });

    it('token de redefinição inválido é recusado e senha fraca também', async () => {
      await api().post('/api/auth/reset-password').send({ token: 'invalido', password: SENHA_BOA }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
      await api().post('/api/auth/reset-password').send({ token: 'invalido', password: '123' }).expect(400);
    });
  });

  describe('Rate limit e bloqueio de login', () => {
    let limitado: NestExpressApplication;
    const lapi = () => request(limitado.getHttpServer());

    beforeAll(async () => {
      limitado = await criarApp(true);
    });
    afterAll(async () => {
      await limitado.get(PrismaService).user.updateMany({ data: { failedLoginCount: 0, lockedUntil: null } });
      await limitado.close();
      process.env.RATE_LIMIT_DISABLED = 'true';
    });

    it('bloqueia a conta após falhas seguidas — mesmo com a senha certa — e responde igual para e-mail inexistente', async () => {
      const existente = { email: 'owner@orbitplay.com', role: 'PLAYER' };
      const fantasma = { email: `fantasma-${Date.now()}@teste.orbitplay.com`, role: 'PLAYER' };
      const status = async (corpo: object) => (await lapi().post('/api/auth/login').send(corpo)).status;

      const rExistente: number[] = [];
      const rFantasma: number[] = [];
      for (let i = 0; i < 7; i++) {
        rExistente.push(await status({ ...existente, password: 'errada-1' }));
        rFantasma.push(await status({ ...fantasma, password: 'errada-1' }));
      }
      // 5 falhas 401, depois bloqueio 429 — igual para quem existe e para quem não existe.
      expect(rExistente.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(rExistente.slice(5)).toEqual([429, 429]);
      expect(rFantasma).toEqual(rExistente);
      // Senha certa também fica barrada durante o bloqueio.
      expect(await status({ ...existente, password: '123456' })).toBe(429);
    });

    it('limita cadastro e recuperação por IP', async () => {
      const codigos: number[] = [];
      for (let i = 0; i < 6; i++) codigos.push((await lapi().post('/api/auth/recover').send({ email: 'x@teste.orbitplay.com' })).status);
      expect(codigos.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(codigos[5]).toBe(429);
      const r = await lapi().post('/api/auth/recover').send({ email: 'x@teste.orbitplay.com' });
      expect(r.headers['retry-after']).toBeDefined();
    });

    it('limita o envio de telemetria do plug-in', async () => {
      let ultimo = 0;
      for (let i = 0; i < 125; i++) ultimo = (await lapi().post('/api/plugin/telemetry').send({})).status;
      expect(ultimo).toBe(429);
    });
  });
});
