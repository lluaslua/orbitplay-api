# AGENTS.md

Instruções de trabalho para agentes e pessoas neste repositório. Vale para todo trabalho de código na API do OrbitPlay. Em conflito com o README, este arquivo ganha; o README descreve o que existe, este arquivo descreve como mexer.

**O idioma do projeto é o pt-BR.** Commit, PR, documentação, mensagem de erro e nome de caso de teste em português. A regra 4 abaixo diz o que fica em inglês.

A API é o backend do OrbitPlay em NestJS 11 com PostgreSQL via Prisma 6. Ela cumpre o contrato que o app (`orbitplay-app`) já consome e as regras do Handoff de Desenvolvimento v1.6 e do Figma "Orbit Play ATUALIZADO": permissão, preço, pagamento, saldo, XP, status e métricas são decididos aqui, nunca no front.

## Comandos

| Comando | Para quê |
| --- | --- |
| `npm run start:dev` | API em watch em http://localhost:3333/api |
| `npm run typecheck` | Verificação obrigatória antes de entregar |
| `npm run build` | Build de produção em `dist/` |
| `npm run test:e2e` | Jest e2e contra o banco do `.env`, depois do seed |
| `npm run db:migrate` | Cria migração nova a partir do `schema.prisma` |
| `npm run db:deploy` | Aplica as migrações existentes |
| `npm run db:seed` | Apaga o banco e carrega as contas e os dados de demonstração |
| `npm run db:up` / `db:down` | Postgres local em `.pgdata` na porta 5433 (caminho do `pg_ctl` é do Windows) |
| `npm run format` | Prettier em `src`, `prisma` e `test` |

O critério de sucesso verificável é `npm run typecheck` e `npm run test:e2e` passando, mais a rota afetada chamada de verdade com a API no ar. Rode e reporte a saída real, inclusive falha. Nada de "deve funcionar".

## Regras de mudança

1. Menor diff que resolve o pedido. Nada de feature, abstração, configuração ou tratamento de erro que ninguém pediu. Motivo: diff grande esconde regressão no review e mistura assuntos num PR só.
2. Toque só as linhas que o pedido exige. Refatoração de código vizinho só com aviso prévio e ok explícito.
3. Dependência nova entra sem vulnerabilidade conhecida e com justificativa de uma linha do que ela faz que não dá para fazer local. Rode `npm audit` depois de instalar. Motivo: cada pacote é superfície de ataque e custo de atualização para sempre. O que já está aqui cobre quase tudo: `@nestjs/config` (env), `@nestjs/jwt` (sessão), `class-validator` e `class-transformer` (DTO), `bcryptjs` (senha), Prisma (banco), multer do `platform-express` (upload).
4. Identificador de código em inglês, como o resto da API (`PlaytestsService`, `findOne`, `setStatus`). Em pt-BR ficam mensagem de erro para o usuário, nome de caso de teste, commit, PR e documentação. Os códigos de erro (`error-codes.ts`) e os enums de contrato (`STUDIO`, `PLAYER`, `ACTIVE`) não mudam de nome. Motivo: o app compara esses valores literalmente, e renomear aqui quebra a tela sem erro de compilação.
5. Nada carregado ou mantido vivo além do que a operação usa: `select` do Prisma só com os campos que a resposta monta, stream de arquivo fechado no erro, job e timer com parada no `onModuleDestroy`, como o `PlaytestsLifecycleService`. Motivo: a API fica no ar sem reiniciar, e o que vaza acumula até derrubar o processo.
6. Variável nova ou alterada em `config/configuration.ts` entra no `.env.example` com valor de exemplo ou o padrão e uma linha dizendo para que serve. Motivo: o `.env` não vai para o git, e quem clona só descobre a variável que falta quando a API não sobe.

## Onde colocar cada coisa

```
prisma/
  schema.prisma          modelo de dados
  migrations/            SQL versionado, nunca editado depois de aplicado
  seed.ts, seed-data/    contas e dados de demonstração
src/
  main.ts                prefixo /api, CORS, limite de body, /api/files público
  app.module.ts          módulos, guards globais e idempotência
  config/                leitura do .env
  contracts/             tipos de resposta, espelho de orbitplay-app/src/types
  prisma/                PrismaService
  common/                access, constants, decorators, filters, guards, idempotency,
                         interfaces, mail, settings, pagination, pipes, utils
  modules/<dominio>/     controller, service, module, mapper e dto/ de cada área
test/                    e2e
```

Módulo novo segue o formato dos que existem: controller fino, regra no service, conversão do model do Prisma para o contrato num `*.mapper.ts`, entrada validada por DTO em `dto/`.

## Contrato com o app

- `src/contracts` é a fonte do formato de resposta. Mudou um tipo aqui, o mesmo arquivo muda em `orbitplay-app/src/types` no mesmo ciclo, e o PR diz isso. Motivo: o app tem a própria cópia dos tipos, então a divergência só aparece em tempo de execução.
- Resposta devolve só o que a tela consome. Nada de hash, senha, token, timestamp de auditoria ou flag interna no payload. Motivo: campo exposto vira compromisso com o cliente e vaza dado; tirar depois quebra quem passou a usar.
- Erro sai sempre como `{ message, code?, fields? }` pelo `ApiExceptionFilter`. Código novo entra em `common/constants/error-codes.ts`.
- Lista aceita `?page=&pageSize=` e devolve o total em `X-Total-Count` (`common/pagination`).
- Ação que cobra, reserva ou credita leva `@Idempotent()` e aceita `Idempotency-Key`. Motivo: o app reenvia quando a rede falha, e sem a chave o mesmo pedido cobra ou credita duas vezes.
- Valor de regra de negócio (faixas de tier, XP, bônus, links) vive na tabela `Setting` com padrão em `settings.defaults.ts`, não chumbado no service. Motivo: esses valores mudam por decisão de produto, e ajustar no banco não exige deploy.
- Rota nova entra na tabela de rotas do README.

## Permissão

- Todo controller passa pelos guards globais: JWT (confere a conta no banco), papel (`@Roles`) e permissão no estúdio (`@RequireStudioPermission`). Rota sem login só com `@Public()`.
- Dado de estúdio é sempre filtrado pela organização da conta (`common/access/studio-scope.ts`). Permissão por jogo passa pelo `GameAccessService`. Motivo: consulta sem esse filtro entrega jogo, teste e relatório de um estúdio para outro.
- Os papéis são `STUDIO` e `PLAYER` no app, mais `OWNER` e `ADMIN` na Central. Papel novo não entra sem frame no Figma e handoff.

## Banco

- Mudança de modelo é `schema.prisma` mais migração gerada por `npm run db:migrate`, com nome que diga o que muda. Migração aplicada não é editada; corrige-se com outra. Motivo: banco que já aplicou não roda a migração de novo e fica diferente do schema sem avisar.
- Migração só acrescenta, a não ser que o pedido diga o contrário: coluna nova com padrão ou opcional. Motivo: remover ou renomear coluna quebra o dado existente e a versão anterior da API enquanto o deploy não termina.
- Escrita que mexe em saldo, vaga ou status junto com notificação roda numa transação só. Motivo: falha no meio deixa recompensa creditada sem notificação ou vaga reservada sem participação.
- Seed é dado de demonstração e pode ser apagado e recriado. Fixture nova entra em `prisma/seed-data/`.

## Vulnerabilidades

`npm audit` limpo é meta do projeto, não relatório para ignorar.

- Pacote novo não entra com alerta aberto.
- Alerta que aparecer sobe para a versão corrigida. Correção major vai num PR só dela, nunca de carona numa feature, com `typecheck`, `build` e `test:e2e` passando.
- Alerta que não dá para corrigir agora fica registrado aqui embaixo, com o motivo, em vez de sumir com `--force`.

## Testes

O runner é o Jest com `ts-jest` e `supertest`, configurado em `test/jest-e2e.json`, rodando em banda contra o banco do `.env`.

- Rode `npm run db:seed` antes. Os testes do catálogo dependem do `test-001`, que o seed abre por 27h32m; passado isso, semeie de novo.
- O que o teste escreve, ele mesmo cria, para rodar de novo sem refazer o seed.
- Regra de negócio nova (permissão, preço, vaga, XP, recompensa, idempotência, status) entra com caso e2e que a garante.
- Um comportamento por caso, com o nome em pt-BR dizendo a regra garantida.
- Correção de bug começa pelo teste: escreva o caso e2e que reproduz o bug, rode e veja falhar, só então corrija e veja passar. Motivo: teste escrito depois da correção pode passar sem nunca ter reproduzido o bug.

## Contas de demonstração

Senha `123456`: `owner@orbitplay.com`, `studio@orbitplay.com` (Blackstar games, MANAGE) e `player@orbitplay.com`. O código do OrbitPlug-in do "Racha de Rua!" é `opk_demo_racha_de_rua_0001`. A lista completa está no README.

## Commit e PR

A `main` é protegida por convenção: nada de commit ou push direto nela. Toda mudança sai numa branch a partir da `main` atualizada e entra por Pull Request, com `npm run typecheck` e `npm run test:e2e` passando antes de abrir.

Mensagem de commit em português, direta, dizendo o que mudou, no escopo do diff. Descrição do PR em português, com o que mudou, o porquê, como conferir e, se o contrato mudou, o que o app precisa acompanhar.

Agente não faz commit nem push sem pedido explícito, e nunca faz force push, `reset --hard` ou mudança no `git config`.

## Antes de entregar

1. `npm run typecheck` e `npm run test:e2e` rodaram e passaram.
2. A rota afetada foi chamada com a API no ar, com a conta do perfil certo e com uma de perfil errado.
3. Nenhum import órfão e nenhum campo a mais na resposta.
4. Se algum tipo de `src/contracts` mudou, o PR diz qual, para o mesmo tipo ser atualizado em `orbitplay-app/src/types`.
5. Migração nova gerada pelo Prisma e aplicada do zero com `db:reset`.
6. Se o diff instalou ou atualizou pacote, `npm audit` não mostra alerta novo.
7. Variável nova do `.env` está no `.env.example`.
