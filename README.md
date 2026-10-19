# OrbitPlay — API

Backend do OrbitPlay em NestJS + PostgreSQL (Prisma). Implementa o contrato que o app já consome pelo mock (`orbitplay-app/src/mocks/routes.ts`) e as regras do **Handoff de Desenvolvimento v1.6**, que joga para o backend permissão, preço, pagamento, saldo, XP, status e métricas.

Em 21/09/2026 a API foi completada com as telas do arquivo Figma **"Orbit Play ATUALIZADO"** (página `Design`, lido pelo MCP `figma-bridge`; a área "VERSÃO ANTIGA - DESCONSIDERAR" ficou de fora): cadastro completo do jogo, equipe e permissões por jogo, OrbitPlug-in da Unity, abas do catálogo, relatórios completos, notificações, ranking e o cálculo de XP e recompensa da tela de conclusão. A migração `20260921120000_figma_atualizado` só acrescenta colunas e tabelas.

## Rodar

1. No `.env`, troque `SUA_SENHA` pela senha do usuário `postgres`. O banco `orbitplay` é criado no passo 3.

2. Instale as dependências:

```bash
npm install
```

3. Crie as tabelas:

```bash
npx prisma migrate deploy
```

4. Carregue as contas e os dados de demonstração. O seed apaga o banco antes:

```bash
npm run db:seed
```

5. Suba a API:

```bash
npm run start:dev
```

Ela fica em http://localhost:3333/api — o `VITE_API_URL` do app. Para o app usar a API, `VITE_USE_MOCKS=false` no `.env.local` de `orbitplay-app`.

### Contas de demonstração

Senha de todas: `123456`.

| Perfil | E-mail | Entra pela aba |
| --- | --- | --- |
| Owner | `owner@orbitplay.com` | qualquer uma |
| Estúdio (Blackstar games, permissão MANAGE) | `studio@orbitplay.com` | Sou um estúdio |
| Jogador | `player@orbitplay.com` | Sou um tester |
| Testers das sessões e do chat | `carlos-mendes@teste.orbitplay.com`, `cellbitos@teste.orbitplay.com`... | Sou um tester |
| Equipe do estúdio (Figma `1187:9418`) | `hideo-kojima@estudio.orbitplay.com` (EDIT, Diretores), `guilherme-hoffmann@estudio.orbitplay.com` (EDIT, QA), `pedro-alves@estudio.orbitplay.com` (EDIT, QA), `marina-lopes@estudio.orbitplay.com` (VIEW, Analitics) | Sou um estúdio |

O código de acesso do OrbitPlug-in do "Racha de Rua!" (para o "Validar código de acesso" da Unity) é `opk_demo_racha_de_rua_0001`.

### Testes

Com o banco semeado:

```bash
npm run test:e2e
```

Cobrem login e papéis, escopo por organização, cotação, criação → pagamento → publicação, início e envio da sessão com idempotência, aprovação liberando a recompensa (com os bônus do Figma e a notificação), acesso ao chat e as travas da Central de usuários. E, das telas do Figma atualizado: opções e "Finalizar" do Novo jogo, exclusão de projeto, permissões por jogo e grupos, código de acesso e telemetria do plug-in, exportação do heatmap em .OBJ, testes exclusivos ELITE, build incompatível com o dispositivo, landing pública e ranking.

Os testes do catálogo usam o `test-001`, que o seed abre por 27h32m ("Termina em 27h 32m"). Depois disso, rode o seed de novo.

## Stack e decisões

O critério foi: o que resolve agora, sem custo, e pode ser trocado depois sem mexer no resto.

| Peça | Hoje | Quando crescer |
| --- | --- | --- |
| Banco | PostgreSQL + Prisma | — |
| Arquivos (builds, gravações, capas) | Disco local, `STORAGE_DIR` (`StorageService`) | S3 ou Azure Blob — troca a classe |
| Pagamento | Gateway `sandbox`, aprova na hora (`PaymentGateway`) | Mercado Pago/Pagar.me/Stripe, com webhook assinado |
| E-mail (recuperação, convite) | Sai no log da API (`MailService`) | SMTP/SES — **antes de produção** |
| Análise da sessão | Heurística local (`AnalysisService`) | Whisper + LLM, atrás de uma fila (Redis/RabbitMQ) |
| Chat | Polling de 5 s, como o app já faz | WebSocket |

Ficaram de fora, por enquanto: ElasticSearch, banco vetorial, LangGraph e FastAPI.

## Estrutura

```
prisma/
  schema.prisma          modelo de dados
  migrations/            SQL versionado
  seed.ts, seed-data/    fixtures do app convertidas para o modelo real
src/
  main.ts                prefixo /api, CORS, body de 5 MB, /api/files público
  app.module.ts          módulos, guards globais (JWT → papel → permissão no estúdio) e idempotência
  config/                leitura do .env
  contracts/             tipos do app + os das telas novas (pricing, build, payment, wallet, gameplay, admin, team, plugin, notification, ranking)
  prisma/                PrismaService
  common/
    access/              escopo da organização e permissões por jogo (GameAccessService)
    constants/           códigos de erro e enums para validação
    decorators/          @Public, @Roles, @RequireStudioPermission, @CurrentUser
    filters/             todo erro sai como { message, code?, fields? }
    guards/              JWT (confere a conta no banco), papel, permissão no estúdio
    idempotency/         Idempotency-Key nas ações críticas
    mail/, storage/      e-mail e arquivos
    settings/            tabela Setting com valores padrão (tier, bônus, XP, plug-in, downloads, tutorial)
    pagination/          ?page&pageSize + X-Total-Count
  modules/
    auth/ users/         login, cadastro, recuperação, sessão
    games/ builds/       jogos, capas, upload de build e Orbit Plug-in
    pricing/ playtests/  tabela de preços, cotação, testes
    payments/            checkout, webhook, comprovante
    player/ gameplay/    catálogo, participação, sessão, eventos, gravação
    wallet/              carteira e saque
    sessions/ reports/   sessões, validação, relatórios
    studio/ team/        dashboard, membros, grupos e permissões por jogo
    plugin/              código de acesso, configuração da Unity e telemetria do OrbitPlug-in
    notifications/       o sino da navbar
    me/ public/          a própria conta; landing, downloads e tutorial sem login
    community/           chat do jogo
    analysis/            análise da sessão
    admin/ audit/        Central de usuários e auditoria
test/                    e2e
```

## Rotas

Tudo sob `/api`. Listas aceitam `?page=&pageSize=` e devolvem o total no cabeçalho `X-Total-Count`. Ações marcadas com ⟳ aceitam o cabeçalho `Idempotency-Key`.

| Área | Rotas | Quem |
| --- | --- | --- |
| Auth | `POST auth/login` · `auth/register` · `auth/logout` · `auth/recover` · `auth/reset-password` · `GET auth/me` | público / logado |
| Minha conta | `PATCH me` (nome, idioma) · `POST me/avatar` · `POST me/password` | logado |
| Jogos | `GET games` (`?search=` e, para o jogador, `?tab=POPULAR\|TOP_PAYING\|NEW\|ELITE\|COMMUNITIES`) · `GET games/options` · `GET games/:id` · `POST games` ⟳ · `PATCH games/:id` · `DELETE games/:id` · `POST games/:id/images/:banner\|thumbnail\|logo` · `POST games/:id/finish-setup` | leitura: todos · escrita: estúdio com a permissão no jogo |
| Jogo, visão do estúdio | `GET games/:id/my-access` · `GET games/:id/reviews` · `GET/POST games/:id/achievements` · `PATCH/DELETE …/achievements/:id` · `GET/PUT games/:id/access` | estúdio |
| Equipe | `GET studio/members?search=@` · `POST studio/members` ⟳ · `PATCH/DELETE studio/members/:id` · `GET/POST studio/groups` · `PATCH/DELETE studio/groups/:id` · `PUT studio/groups/:id/members` | leitura: estúdio · escrita: MANAGE |
| Builds | `GET/POST games/:gameId/builds` · `GET/PATCH games/:gameId/builds/:id` (plataformas) · `PATCH …/:id/plugin` | estúdio |
| OrbitPlug-in | `GET/POST games/:gameId/plugin/keys` · `DELETE …/keys/:id` · `GET games/:gameId/plugin/config` | estúdio |
| OrbitPlug-in, na Unity e no jogo | `GET plugin/info` · `POST plugin/validate` · `PUT plugin/config` (cabeçalho `X-Orbit-Plugin-Key`) · `POST plugin/telemetry` (token de `POST player/participations/:id/telemetry-token`) | público com código / token |
| Preços | `GET pricing/catalog` · `POST pricing/quote` | estúdio |
| Testes | `GET/POST tests` ⟳ · `GET tests/:id` · `PATCH tests/:id/status` · `POST tests/:id/finish` | estúdio |
| Pagamento | `POST tests/:id/checkout` ⟳ · `GET tests/:id/payment` · `GET payments/:id` · `GET payments/:id/receipt` · `POST payments/webhooks/:provider` | estúdio MANAGE / provedor |
| Sessões | `GET sessions` · `GET sessions/:id` · `GET sessions/:id/video` · `POST sessions/:id/validation` · `POST sessions/:id/feedback` · `POST sessions/:id/retest` | estúdio |
| Relatórios | `GET reports/:testId` · `…/answers` · `…/insights` · `…/export?format=csv` · `…/plugin` · `…/plugin/heatmaps/:map/export?format=json\|obj` · `…/sessions/:sessionId` | estúdio com "Acessar relatórios" |
| Dashboard | `GET studio/dashboard` | estúdio |
| Jogador | `GET player/dashboard` · `catalog` · `participations` · `achievements` · `ranking?period=` · `games/:id/tests\|achievements\|history` · `session-review` · `session-outcome` · `PATCH player/profile` · `POST player/tutorial/seen` · `POST player/tests/:id/start` · `…/submit` ⟳ | jogador |
| Gameplay | `POST player/participations/:id/consent` · `PATCH …/progress` · `POST …/events` · `POST …/recording` | jogador |
| Build do tester | `GET player/tests/:id/build` · `…/build/file` (aceita `Range`) | jogador |
| Carteira | `GET player/wallet` · `POST player/withdrawals` ⟳ | jogador |
| Comunidade | `GET games/:gameId/community` · `GET/POST …/channels/:channelId/messages` (`?after=` / `?before=`) · `POST …/messages/:id/reaction` · `DELETE …/messages/:id` | estúdio dono / tester que jogou |
| Notificações | `GET notifications?unread=` · `GET notifications/unread-count` · `POST notifications/:id/read` · `POST notifications/read-all` | logado |
| Sem login | `GET public/games?tab=` · `GET public/downloads` · `GET plugin/info` | público |
| Conteúdo | `GET content/tutorial` | logado |
| Central | `GET/POST admin/users` · `PATCH admin/users/:id` · `…/status` · `…/role` · `POST …/password-reset` · `GET admin/audit-logs` · `GET/POST admin/studios` · `POST admin/studios/:id/balance` · `GET admin/withdrawals` · `PATCH admin/withdrawals/:id` | Owner / Admin |

## Regras do handoff que a API garante

- **Permissão:** papel real da conta na sessão (Tela 01, RN-03). Tudo de estúdio filtrado pela organização (Telas 02 e 03, RN-01). Conta desativada ou com papel trocado perde o acesso na hora.
- **Senha:** bcrypt; o "Lembrar login" muda a duração da sessão; a recuperação usa um token de uso único (Tela 01, RN-02 a RN-05).
- **Novo teste:**
  - pergunta de escolha com pelo menos 2 opções (Tela 07, RN-02);
  - build validada antes de publicar, e o plug-in obrigatório no modelo com telemetria e recusado nos outros (Tela 08, RN-01 a RN-03);
  - faixa etária dentro de 16–99, com a mínima menor ou igual à máxima (Tela 09, RN-02);
  - preço sempre recalculado aqui (Tela 09, RN-03 e RN-06).
- **Pagamento:** o teste só vai a ACTIVE com o pedido pago; há um pedido por teste, repetir não cobra de novo, e o comprovante só existe depois da confirmação (Tela 10).
- **Jogador:**
  - elegibilidade por localização, idade, tipo e arquétipo (Tela 14, RN-01);
  - vaga reservada de forma atômica, sem duas participações no mesmo teste (Tela 14, RN-02);
  - respostas obrigatórias conferidas e envio idempotente (Tela 18, RN-01 e RN-03);
  - a recompensa só vai ao saldo com a aprovação do estúdio (Tela 19, RN-04);
  - o saque é decidido pela API (Tela 13, RN-03).
- **Gravação:** só com consentimento; eventos de microfone e webcam com o tempo da sessão (Telas 16 e 17).
- **Relatórios:** só com sessões válidas, com o estado "processando" enquanto a análise roda (Tela 11, RN-01 e RN-02).
- **Central:** não rebaixa nem desativa o último Owner; Admin não mexe em Owner; toda mudança é auditada; a desativação é lógica (Tela 20).

## Regras do Figma atualizado

- **Novo jogo (`1180:3359`, `1187:8743`, `1187:9418`, `1188:10297`):** cada passo salva com só o nome; o "Finalizar" (`finish-setup`) cobra os campos com * e as três imagens e devolve em `fields` o que falta. Gêneros, sub-gêneros, modos, engines, estágios, classificação e idiomas são as listas do Figma (`GET games/options`). Jogo sem o cadastro finalizado não recebe teste. Excluir só vale para jogo sem teste publicado — com histórico, arquive.
- **Permissões por jogo:** quatro permissões — `MANAGE_ACCESS` (editar permissões/excluir), `EDIT_INFO`, `MANAGE_TESTS`, `VIEW_REPORTS` — dadas a membros ou grupos. Quem cria o jogo recebe as quatro; quem tem MANAGE no estúdio pode tudo; jogo sem nenhuma linha segue a permissão do estúdio, como antes. Ninguém tira de si o `MANAGE_ACCESS`, e o estúdio nunca fica sem um MANAGE.
- **OrbitPlug-in (`423:2774`, `425:3032`, `423:3000`):** o estúdio gera o código de acesso (só o hash fica no banco); a Unity valida e envia mapas e gatilhos; a varredura da build junta o manifesto do SDK com essa configuração. Durante o teste, o app pede um token de telemetria e passa para a build; o jogo manda TRIGGER, POSITION e DEATH (com a causa da morte) em lotes de até 500. O heatmap exportado leva o mapa a 0,0,0 e desenha um cubo por célula.
- **Catálogo (`849:2926`):** abas Populares, Pagando mais, Novos jogos, Exclusivos ELITE e Comunidades, com busca. Teste `eliteOnly` aparece para todos e só abre para o tier ELITE. O tier é recalculado a cada envio pelas faixas da `Setting` `tierRules` (tiers dados à mão, como QA, não mudam).
- **Dispositivo (`199:1291`, `319:8624`):** a build sabe em que sistema roda; o app manda `X-Client-Platform` (`win32`, `darwin`, `linux` ou o código); teste de build incompatível vira "Indisponível para seu dispositivo" e o `start` devolve 409 `DEVICE_INCOMPATIBLE`. Sem o cabeçalho, nada é barrado.
- **Conclusão (`287:5085`):** XP = base 50 + 5 por feedback completo + 5 se reportou bug; recompensa = crédito base + R$ 0,05 por feedback completo + R$ 0,05 por bug. Os valores ficam nas `Setting` `xpRules` e `rewardBonuses`. Conquistas de contagem trazem `progress` ("Piloto Frequente 5/10"), e as regras novas liberam "Crítico Construtivo", "Cobaia de Protótipo", "Caçador de Bugs" e "Fonte Primária".
- **Relatórios (`326:6452`, `329:9178`, `427:3376`):** "Todas as avaliações" por pergunta, grade de insights com busca e categoria, CSV, tempo médio do formulário (`formSeconds` no envio) e taxa de desistência. A análise grava insights da sessão com o segundo da gravação e, se falhar, é refeita pelo job de 60 s — nenhum teste fica "Gerando insights IA" para sempre.
- **Notificações:** recompensa liberada ou recusada, saque pago ou recusado, agradecimento e convite do estúdio, conquista, sessão nova para validar, teste publicado, relatório pronto e acesso a um jogo. Saem na mesma transação do que aconteceu.

## O que o app precisa mudar para usar a API

O que o app já chama continua funcionando com o mesmo formato. Mas algumas telas hoje simulam no front o que agora é da API:

1. **Etapa 3:** enviar a build (`POST games/:gameId/builds`), acompanhar até `VALID` e mandar o `buildId` no `POST tests`.
2. **Etapas 4 e 5:**
   - ler preços de `GET pricing/catalog`;
   - chamar `POST pricing/quote` a cada mudança;
   - depois do `POST tests` (que cria DRAFT), chamar `POST tests/:id/checkout`;
   - mostrar a etapa 5 só com `PAID`.
3. **Tutorial e gameplay:** registrar o consentimento, mandar os eventos, o progresso e a gravação.
4. **Revisão e conclusão:** passar `?testId=` em `session-review` e `session-outcome`.
5. **Telas novas:** cadastro, redefinição de senha (`/#/reset-password?token=`), carteira, validação da sessão pelo estúdio e Central de usuários.
6. **Contratos:** copiar os arquivos novos de `src/contracts` (`pricing`, `build`, `payment`, `wallet`, `gameplay`, `admin`, `team`, `plugin`, `notification`, `ranking`) e as mudanças de `auth.ts`, `game.ts`, `player.ts`, `report.ts` e `test.ts` para `orbitplay-app/src/types`. O tipo `Genre` agora é a lista em inglês do Figma (`Racing`, `Action`...).
7. **Novo jogo (Figma `1180:3359` a `1188:10297`):** ligar o card "Novo jogo!" de Meus jogos ao wizard — `GET games/options` nos dropdowns, `POST games` no primeiro "Salvar", `PATCH` nos seguintes, `POST games/:id/images/banner|logo|thumbnail` nas mídias, `GET studio/members?search=@` e `GET studio/groups` no modal "Adicionar membro", `PUT games/:id/access` e `POST games/:id/finish-setup` no "Finalizar".
8. **Cabeçalho `X-Client-Platform`:** mandar `process.platform` do Electron em toda chamada do jogador.
9. **Jogos disponíveis:** as abas viram `?tab=` e a busca `?search=` em `GET games`.
10. **Sino e idioma da navbar:** `GET notifications/unread-count` no polling, `GET notifications` ao abrir, `PATCH me` no seletor "PT".
11. **Tutorial e gameplay:** `GET content/tutorial` no modal, `POST player/tutorial/seen` ao terminar (`tutorialSeen` no usuário decide o "Rever tutorial"), `POST player/participations/:id/telemetry-token` ao abrir a build do teste com plug-in.
12. **Relatório:** as abas "Todas as Avaliações" (`answers`), "Insights de IA" (`insights`), os botões de exportar (`export?format=csv`), "Baixar mapa .OBJ" (`plugin/heatmaps/:map/export?format=obj`) e, no detalhe da sessão, "Solicitar novo teste" (`retest`), "Agradecer" (`feedback`) e "Pedir anulação" (`validation` com `approved: false`).
13. **Home do jogador:** "Missões e Ranking" pode abrir `GET player/ranking`; o `rankDelta` do dashboard já vem calculado.
14. **Configuração do jogo:** "Configurar Orbit Plug-in" gera o código em `POST games/:id/plugin/keys`; as abas "Avaliações" e "Conquistas" usam `games/:id/reviews` e `games/:id/achievements`.
15. **Etapa 3:** o switch "Jogável com controle*" vai em `requiresController` no `POST tests` (hoje ele liga `requiresRecording` por engano).

## O que ainda falta

- **IA de verdade:** transcrição (Whisper) e insights (LLM). Hoje a análise é heurística, e a transcrição fica vazia fora do seed.
- **Gateway de pagamento real,** com webhook assinado.
- **SMTP antes de produção:** hoje o link de redefinição aparece no log da API.
- **Armazenamento em nuvem** para builds e gravações, e antivírus no upload.
- **Proteção contra força bruta** no login (rate limit).
- **Links reais do plug-in e dos instaladores:** `pluginInfo` e `appDownloads` na tabela `Setting` apontam para `/files/downloads/...`; troque pelas URLs de verdade quando os arquivos existirem.
- **Contrato:** as grades de pergunta não têm linhas e colunas separadas.
- **Fora do escopo do Figma atualizado:** as ideias das notas soltas (pacotes Free/Starter/Pro/Enterprise, gift cards, sorteios, títulos de perfil) e as páginas do menu sem frame (Benchmark, Plug-in Telemetria, Tutorial e formação do estúdio, Ajuda).
