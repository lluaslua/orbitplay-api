# Documentação de Segurança — OrbitPlay

Convenção: ✅ implementado e presente no código · ⚙️ depende de configuração externa · 🔭 recomendação futura.

## 1. Introdução
A OrbitPlay conecta estúdios a jogadores testers (playtests, feedback, telemetria, relatórios, carteira). Este documento descreve as regras de segurança aplicadas em `orbitplay-api` e `orbitplay-app`. O backend é a autoridade final; o frontend só melhora a experiência.

## 2. Objetivos
Proteger contas, dados de estúdios, builds, feedbacks, telemetria, relatórios e saldos; impedir acesso entre estúdios; impedir manipulação de valores; manter rastro de eventos de segurança.

## 3. Arquitetura de segurança
Camadas na ordem em que a requisição passa (`app.setup.ts` e `app.module.ts`): headers → CORS → parsers com limite → `IpRateLimitGuard` → `JwtAuthGuard` (assinatura, audiência, revogação, usuário ativo, sessão não invalidada) → `UserRateLimitGuard` → `RolesGuard` → `StudioPermissionGuard` → verificação de propriedade/acesso ao jogo nos services → DTO com `whitelist` → serviço com transação.

## 4. Modelo de ameaças (resumo)
Atacante anônimo (força bruta, enumeração, webhook falso); tester malicioso (telemetria forjada, IDOR, manipular recompensa, upload malicioso); estúdio malicioso (ver dados de outro, escalar permissões); membro interno com poder parcial; XSS na interface (roubo de token, abuso do Electron); servidor de download falso. Fora de escopo: comprometimento do servidor/banco.

## 5. Vulnerabilidades identificadas
Ver `RELATORIO_AUDITORIA_ORBITPLAY.md` (18 itens com criticidade e evidência).

## 6. Medidas implementadas
Todas as listadas nas seções abaixo; cada uma tem teste em `test/security.e2e-spec.ts` ou nos testes do app, exceto onde indicado.

## 7. Política de autenticação
✅ Login por e-mail+senha+aba (papel). ✅ Conta inativa/pendente não entra. ✅ Bloqueio por 5 falhas seguidas durante 15 min (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`); contador em memória cobre também e-mails inexistentes, então a resposta (401 e depois 429) é igual. ✅ Limite de 10 tentativas/min por IP+e-mail. ✅ Recuperação de senha: resposta idêntica, envio em segundo plano, link de 60 min, uso único, pedido novo cancela os anteriores, redefinir invalida sessões. ✅ Cadastro só entra depois do código de 6 dígitos do e-mail (10 min, 5 tentativas, hash no banco). ✅ "MFA por E-mail" opcional na Minha conta: o login com senha certa pede o código. 🔭 MFA obrigatório para OWNER/ADMIN. ⚙️ SMTP (`SMTP_HOST`, obrigatório em produção).
Nota: o cadastro ainda responde 409 para e-mail já usado (enumeração aceita por UX; mitigada por 10 cadastros/hora/IP).

## 8. Autorização e permissões
✅ Papéis `PLAYER`, `STUDIO`, `ADMIN`, `OWNER`. ✅ Permissão de estúdio `VIEW < EDIT < MANAGE`, colunas de equipe (`MANAGE_USERS`, `DELETE_USERS`…) e permissões por jogo/grupo (`GameAccessService`). ✅ Ninguém concede permissão a si mesmo. ✅ Trocar a senha de alguém exige ser admin do estúdio ou que o alvo não tenha poder que o ator não tenha. ✅ Rotas `/admin` só `ADMIN/OWNER`; ADMIN não edita OWNER.

## 9. Regras de acesso aos recursos
Estúdio só enxerga/altera dados do próprio estúdio (e só dos jogos a que tem acesso). Jogador só acessa os próprios dados, jogos ativos, e só baixa a build durante participação em andamento. Relatórios, feedbacks e sessões só para o estúdio dono com permissão. Cobertas pelos testes de "Isolamento entre estúdios".

## 10. Proteção de dados pessoais
✅ Senhas só em bcrypt; respostas não vazam hash nem campos internos. ✅ Logs de segurança usam hash do e-mail, nunca senha/token. ✅ Em produção o e-mail com link de redefinição não é logado. 🔭 Criptografia em repouso da chave PIX e de PII; política de retenção/LGPD.

## 11. Segurança das APIs
✅ DTO com `whitelist` (mass assignment) + mapeamento explícito nos services. ✅ Prisma parametrizado (sem SQL inseguro). ✅ Limite de corpo 1 MB (20 MB só em rotas de imagem). ✅ Rate limit global (600/min/IP) e por rota. ✅ Erros 5xx genéricos; 4xx do body-parser tratados. ✅ CORS por lista, métodos e headers explícitos.

## 12. Uploads e builds
✅ Imagens: JPG/PNG/WebP, 5 MB, assinatura conferida; SVG/HTML recusados. ✅ Builds: `.zip .exe .apk .dmg .unity .unreal`, limite `BUILD_MAX_SIZE_MB`, assinatura conferida onde existe (zip/apk `PK`, exe `MZ`). ✅ Vídeo: WebM/MP4 até 500 MB. ✅ Chave resolvida e restrita à raiz (sem traversal); extensão vem do tipo, não do nome. ✅ Builds e vídeos em `private/`, servidos só por rota autorizada; `public/` sai com `nosniff` e `CSP sandbox`. ⚙️ 🔭 Antivírus/sandbox de análise; URLs assinadas temporárias; armazenamento em S3/Blob.

## 13. Segurança do OrbitPlug-in
✅ Chave `opk_…` guardada só como hash, revogável, por jogo. ✅ Token de telemetria de 1 h, audiência própria, preso à participação em andamento. ✅ Telemetria exige token; rate limit 120/min; eventos limitados (tempo plausível, 2000 caracteres de payload, 50 000 por participação, coordenadas limitadas). ✅ `lastUsedAt` gravado no máximo 1×/min. 🔭 Assinatura HMAC por sessão no SDK (o segredo embutido é extraível; só eleva o custo).

## 14. Feedbacks e telemetria
✅ Eventos só entram em participação `IN_PROGRESS` do próprio tester. ✅ Bugs informados ≤ bugs registrados; duração ≤ tempo decorrido; respostas com tamanho máximo. ✅ Relatórios só ao estúdio dono. ⚠️ Telemetria vinda do cliente do tester é, por natureza, não confiável; os limites só barram o impossível. Anexos de resposta são públicos por URL aleatória (risco residual).

## 15. Segurança financeira
✅ Preço, saldo e recompensa calculados no servidor. ✅ Saque com `FOR UPDATE`, valor inteiro positivo, mínimo e saldo; `Idempotency-Key` impede duplicidade (testado com 3 requisições concorrentes). ✅ Webhook: `X-Orbit-Signature: t=<unix>,v1=<HMAC-SHA256("<t>.<corpo>")>`, tolerância 300 s, comparação em tempo constante, valor conferido, só pedido `PENDING` muda, `PAYMENT_WEBHOOK_SECRET` obrigatório. ✅ Produção recusa `sandbox`. ⚙️ Implementar o gateway real (assinatura do próprio provedor). 🔭 Conciliação periódica com o provedor; saldo do estúdio não pode ficar negativo por concorrência (hoje possível por pouco).

## 16. Proteção do frontend
✅ Sem HTML cru; dados da API renderizados como texto. ✅ Token em `sessionStorage` (sem "Lembrar login") ou `localStorage` (com), fora do store persistido. ✅ 401 limpa a sessão; logout revoga na API. ✅ CSP de produção sem inline/eval. ✅ Rotas privadas por papel (apenas UX; o backend decide). ✅ Electron: `contextIsolation`, `sandbox`, sem navegação externa, `https` apenas em links externos, IPC só de origem confiável, download só da API configurada com SHA-256, instalador só o anunciado no feed. 🔭 Cookies `HttpOnly` + CSRF (mudança estrutural).

## 17. Política de senhas e tokens
Senha nova: 8–72 bytes, ao menos 1 letra e 1 número, fora da lista de comuns e não repetida (`password-policy.ts`); o app exige ainda maiúscula, minúscula e símbolo. Bcrypt custo 12 (`BCRYPT_COST`), refeito no login se menor. Token de acesso: HS256, `iss=orbitplay`, `aud=orbitplay-api`, `jti`, 12 h (30 dias com "lembrar"); revogado no logout e invalidado por troca/redefinição de senha (`sessionsValidAfter`). Telemetria e vídeo têm audiências próprias.

## 18. CORS, HTTPS e headers
✅ `CORS_ORIGINS` lista exata (nunca `*`). `null` é necessário ao Electron em `file://` e é risco aceito. ✅ Headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP default-src 'none'`, `COOP`, `CORP`, `Permissions-Policy`, `Cache-Control: no-store`, `HSTS` em produção. ⚙️ Terminar TLS no balanceador/proxy e definir `TRUST_PROXY_HOPS`. Produção exige `PUBLIC_API_URL` e `APP_URL` https.

## 19. Logs e monitoramento
✅ `SecurityLogService` emite linhas JSON (`login_failed`, `login_blocked`, `rate_limit`, `password_reset`, `ws_origin_refused`…) sem dados sensíveis. ✅ Auditoria de ações administrativas já existente (`AuditLog`). ⚙️ Enviar a um agregador e alertar sobre picos. 🔭 Registrar também negações 403 repetidas.

## 20. Variáveis de ambiente
Ver `orbitplay-api/.env.example`. Obrigatória: `JWT_SECRET`, `DATABASE_URL`. Do app: `VITE_API_URL` (entra na CSP e na origem permitida do Electron).

## 21. Configuração segura de produção
`NODE_ENV=production` ativa as validações: `JWT_SECRET` ≥ 32 e não padrão, CORS sem `*`, gateway diferente de `sandbox`, `PUBLIC_API_URL`/`APP_URL` https. Não rodar o seed. Banco com TLS e usuário restrito. `storage/` fora da aplicação, com backup. `private/` nunca exposta por web server. `npm ci --omit=dev`. Rotacionar o `JWT_SECRET` invalida todas as sessões.

## 22. Testes de segurança
`cd orbitplay-api && npm run test:e2e` (ver instruções; 108 testes) e `cd orbitplay-app && npx vitest run` (104). Resultados da auditoria no relatório.

## 23. Riscos residuais
Rate limit em memória; telemetria do cliente não confiável; anexos públicos por URL secreta; sem MFA; sem assinatura de código; sem antivírus; PIX em texto no banco; bloqueio de conta usável para negação temporária; token legível por JS se houver XSS; `Origin: null`.

## 24. Manutenção
Rodar `npm audit` a cada release; renovar dependências críticas; rotacionar segredos (JWT, webhook) periodicamente; revisar permissões de equipe; testar restauração de backup; refazer a auditoria ao adicionar gateway real, SMTP, S3 ou novos endpoints públicos; manter os testes de segurança no CI.
