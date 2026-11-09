# Instalação, configuração e execução — OrbitPlay (versão com segurança)

Requisitos: Node.js 20+ (testado em 22), PostgreSQL 14+ (testado em 16), npm.

## API (`orbitplay-api`)
```bash
cd orbitplay-api
cp .env.example .env          # edite: DATABASE_URL (senha), JWT_SECRET (openssl rand -base64 48), PAYMENT_WEBHOOK_SECRET (openssl rand -hex 32)
npm ci
npx prisma generate
npx prisma migrate deploy     # aplica as 5 migrações, inclusive 20261108120000_seguranca (nova)
npm run db:seed               # SÓ em desenvolvimento: cria contas de demonstração (senha 123456)
npm run start:dev             # http://localhost:3333/api
```
Banco já existente (de antes desta versão): rode só `npx prisma migrate deploy`; a nova migração apenas **acrescenta** duas colunas em `User` e a tabela `RevokedToken`.
Testes: `npm run test:e2e` (precisa do Postgres do `.env`; o seed deve ter sido rodado). Roda `app.e2e-spec.ts` (60) e `security.e2e-spec.ts` (48). O teste de segurança cria contas `@teste.orbitplay.com` e altera o saldo/saques do jogador de demonstração; rode em banco de desenvolvimento.
Observação: `src/common/storage/` foi recriada (o original estava ausente por causa do `.gitignore`). Remova `storage` do `.gitignore` apenas na raiz (`/storage`) para não excluir o código de novo.

## App (`orbitplay-app`)
```bash
cd orbitplay-app
npm ci
# crie .env com VITE_API_URL=http://localhost:3333/api  (entra na CSP do build e na origem aceita pelo Electron)
npm run dev                  # web
npx vitest run               # testes
npm run build                # web (CSP estrita de produção em dist/index.html)
```
Electron: use os scripts já existentes do projeto. Se você usa `publish-local`, rode-o de novo: o `latest.json` agora leva `sha256`. **Teste o Electron manualmente** (download, abrir jogo, atualização), pois não foi executado na auditoria.

## Produção (checklist)
`NODE_ENV=production`; `JWT_SECRET` forte; `PAYMENT_PROVIDER` real + `PAYMENT_WEBHOOK_SECRET`; `PUBLIC_API_URL` e `APP_URL` https; `CORS_ORIGINS` exato; `TRUST_PROXY_HOPS` conforme o proxy; SMTP configurado em `MailService`; Postgres com TLS; `STORAGE_DIR` persistente e com backup; nunca rodar o seed. Sem isso a API se recusa a subir e diz o motivo.

## Atenção ao atualizar
Tokens emitidos antes desta versão deixam de valer (nova audiência/emissor): todos precisam logar de novo. O app antigo, que manda o token do chat na URL do WebSocket, não conecta mais; use o app desta entrega.
