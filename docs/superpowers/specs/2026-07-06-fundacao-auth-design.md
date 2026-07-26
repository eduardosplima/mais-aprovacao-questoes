# Fundação — Auth própria, Webhook Hotmart e Base de Dados (design)

> Sub-projeto 1 de 4 da plataforma **Mais Aprovação Questões**. Companion da
> `docs/especificacao-tecnica.md`. Escopo: **backend apenas** (Worker), sem frontend.
>
> **Reescrito em 2026-07-26.** A versão original deste spec assumia login via
> **Hotmart OAuth 2.0**. A premissa era falsa: a Hotmart não oferece OAuth de
> identidade para login de terceiros — só webhooks e uma API de dados
> server-to-server. Consequência: a plataforma precisa de **autenticação
> própria**, e o webhook de compra (antes sub-projeto 4) passa a ser
> **pré-requisito do login**, porque é ele que cria a conta. O código de OAuth já
> implementado será removido.

## Contexto e decomposição

A plataforma foi decomposta em quatro sub-projetos (eram cinco), cada um com seu
ciclo spec → plano → implementação:

1. **Fundação (este documento)** — Worker, modelo de dados + migrações, webhook
   Hotmart, provisionamento, link mágico + Email Sending, autenticação própria,
   sessão JWT, RBAC, Turnstile server-side, cron de reconciliação.
2. Admin & conteúdo — painel admin, cadastro de questões + taxonomias.
3. Núcleo de estudo — responder/correção, cota freemium (Durable Objects),
   gabarito comentado, comentários, anotações, favoritos.
4. Frontend do aluno — experiência da `docs/demo.html`, responsivo + PWA + SEO,
   telas de autenticação, widget Turnstile, **rota e tela de exclusão de conta**.

O antigo sub-projeto "Assinatura" foi **absorvido pela Fundação**: não faz sentido
como fase posterior quando o webhook é o que provisiona o acesso.

Este spec cobre **apenas o sub-projeto 1**.

## Objetivo e critério de sucesso

Um Cloudflare Worker (TypeScript + Hono) em `api/` onde uma compra aprovada na
Hotmart cria a conta do aluno e lhe envia um link para definir senha; e onde o
aluno autentica com email e senha, obtendo uma sessão validada a cada request,
com papéis (RBAC), entitlement derivado da assinatura e migrações versionadas.

**Pronto quando:**
- A suíte Vitest passa cobrindo webhook, provisionamento, autenticação,
  recuperação, reconciliação e entitlement — com Hotmart, Email e Turnstile
  mockados.
- O fluxo real funciona ponta a ponta contra o **sandbox da Hotmart** (roteiro
  manual documentado), incluindo a conferência dos fixtures de webhook contra um
  evento real.
- As migrações aplicam num D1 local, com as ações de exclusão declaradas.

Sem frontend, sem KV, sem CI — ver "Fora de escopo".

## Decisões-chave

### Autenticação própria substitui o OAuth

Email + senha, com a senha definida por **link mágico** enviado no provisionamento.
Não há autocadastro: a única porta de entrada é a compra na Hotmart. A tela de
login exibirá um link para o checkout (sub-projeto 4).

Link mágico em vez de senha temporária no email: nada de senha em texto claro em
trânsito, o token queima no uso, e o mesmo mecanismo serve ao primeiro acesso e à
recuperação — um único tipo de credencial temporária no sistema.

### `PURCHASE_APPROVED` libera o acesso, não `PURCHASE_COMPLETE`

`PURCHASE_APPROVED` dispara na aprovação do pagamento e em cada renovação.
`PURCHASE_COMPLETE` dispara apenas ao encerrar o prazo de garantia (7 a 30 dias) —
usá-lo faria o aluno pagar e esperar semanas. `COMPLETE` é registrado e ignorado.

### `access_until` é o único predicado de acesso

`tier = 'assinante'` se existir qualquer assinatura do usuário com
`access_until > now`. Uma comparação de data cobre ativa, cancelada com ciclo pago
em curso, atrasada em carência e revogada. `Subscription.status` é auditoria e
**nunca** entra na decisão de autorização — isso mantém a máquina de estados fora
do caminho crítico.

### `Subscription` é 1:N, com PK em `subscriber_code`

O evento `SUBSCRIPTION_CANCELLATION` traz apenas `data.subscriber.code` — não traz
`product.ucode`. Com a PK em `subscriber_code`, o cancelamento é uma busca direta
pela chave primária, e um código desconhecido é ignorado com segurança. Um aluno
que troque de plano tem duas linhas independentes.

### Ausência na API nunca revoga acesso

A reconciliação só revoga quando a API **retorna explicitamente** a assinatura com
status não-ativo ou `date_next_charge` no passado. Um filtro errado ou uma página
que falhe no meio da paginação revogaria a base inteira. Ausência gera log, nunca
ação.

Relacionado: o `start_date` do `GET /subscriptions` tem default de *hoje − 30
dias*. Sem passá-lo explicitamente com data antiga, toda assinatura veterana
parece inexistente.

### Turnstile entra agora, não no frontend

A versão anterior adiava Turnstile para o frontend (sub-projeto 5 na numeração
antiga, hoje o 4) alegando ser "widget de
frontend". Com autenticação própria isso não se sustenta — `/auth/login` e
`/auth/recover` são alvos de força bruta e enumeração — e a justificativa era
tecnicamente errada de todo modo: o widget é frontend, mas a **verificação**
(`siteverify`) é server-side, no Worker. A metade que protege entra aqui; o widget
entra no sub-projeto 4. Os testes usam as chaves de teste oficiais da Cloudflare.

Não em `/auth/set-password`: o token tem 256 bits de entropia, não há o que brutar.

### Convenção de cascata de exclusão desde a primeira migração

Toda FK para `users.id` nasce com ação declarada: `CASCADE` para dados
estritamente pessoais, `SET NULL` para autoria de conteúdo público (comentários,
que passam a exibir "usuário removido"). A rota de exclusão só ships no
sub-projeto 4, mas a convenção é decidida aqui porque é schema — com ela, a
exclusão é um único `DELETE FROM users` e cada tabela criada nos próximos dois
meses entra na cascata automaticamente. Sem ela, seria uma lista de `DELETE`s que
alguém precisaria lembrar de atualizar, e a PII órfã que sobrasse seria
exatamente a falha que a rota existe para evitar.

O D1 aplica foreign keys por padrão (equivalente a `PRAGMA foreign_keys = on`) e
suporta `ON DELETE CASCADE` / `SET NULL`.

### Tombstone de exclusão entra na Fundação

`deleted_accounts` (HMAC do email + data) e suas três condicionais entram aqui,
mesmo com a rota chegando no sub-projeto 4. Motivo: sem elas, o cron recria a
conta excluída na madrugada seguinte e envia um email de boas-vindas a quem pediu
para sair. Implementá-las depois significaria mexer nos dois fluxos mais delicados
do sistema já em produção.

### Documento (CPF) nunca em claro

HMAC-SHA256 com pepper em secret, sobre os dígitos normalizados. Hash simples não
serviria: um CPF tem ~10⁹ candidatos válidos e cai em segundos num ataque de
dicionário. O mesmo helper serve à tombstone de email — daí `lib/hmac.ts`, não
`lib/documents.ts`.

### Senha: PBKDF2 via WebCrypto

100k iterações, salt de 16 bytes, formato `pbkdf2$sha256$100000$<salt>$<hash>` com
os parâmetros embutidos para elevar o custo depois sem migração. Não é
bcrypt/argon2 porque Workers não tem nenhum dos dois nativo — seria WASM,
dependência e bundle. Custo ~40ms de CPU por login: a 45k logins/mês são ~1,8M
CPU-ms contra 30M na franquia.

### Sessão: JWT stateless em cookie (mantido)

Decisão preservada da versão anterior. JWT HS256 em cookie
HttpOnly/Secure/SameSite=Lax, exp 7 dias, carregando apenas `sub`. `role` e tier
são **relidos do D1 a cada request protegido** via `loadEntitlement(userId)` — o
D1 é a fonte da verdade, o que permite revogar acesso sem esperar o token expirar.

Refresh token continua adiado (sem frontend não há quem faça refresh silencioso);
KV continua fora — pode entrar depois como cache de leitura dentro de
`loadEntitlement`, sem mudar endpoints nem o formato do cookie.

### Clientes externos injetáveis

Hotmart (API de dados), Email e Turnstile são acessados por interfaces com
implementação real e fake. Nenhuma rede nos unit tests; os fluxos reais são
exercitados manualmente contra o sandbox. O `EMAIL` já é naturalmente injetável
por ser binding do `env`.

## Arquitetura / layout (`api/`)

- `src/index.ts` — bootstrap do Hono, registro de rotas, middlewares e o handler
  `scheduled` do cron.
- `src/config/env.ts` — bindings, secrets e parsing (`ucodes`, `admin emails`).
- `src/db/schema.ts` — schema Drizzle das 5 tabelas, com ações de exclusão.
- `src/db/users.ts` — upsert por email, `loadEntitlement`, exclusão.
- `src/db/subscriptions.ts` — upsert por `subscriber_code`, revogação,
  ajuste de `access_until`.
- `src/db/authTokens.ts` — criar, consumir, invalidar, checar cooldown.
- `src/db/webhookEvents.ts` — claim de idempotência e marcação de status.
- `src/db/deletedAccounts.ts` — tombstone: gravar, checar, limpar.
- `src/lib/password.ts` — hash e verificação PBKDF2.
- `src/lib/tokens.ts` — geração do token opaco e seu SHA-256.
- `src/lib/hmac.ts` — normalização + HMAC (documento e email).
- `src/lib/email.ts` — templates e envio via `env.EMAIL`.
- `src/lib/turnstile.ts` — verificação `siteverify`.
- `src/lib/hotmartApi.ts` — `client_credentials` + `listSubscriptions` paginado.
- `src/lib/jwt.ts` — assinar/verificar o JWT de sessão *(mantido)*.
- `src/lib/cookies.ts` — cookie de sessão *(enxugado: o state cookie morre)*.
- `src/webhooks/hotmart.ts` — rota, validação Zod e despacho de eventos.
- `src/jobs/reconcile.ts` — o cron de reconciliação.
- `src/middleware/session.ts` — extrai/valida o JWT, popula o contexto *(mantido)*.
- `src/middleware/rbac.ts` — exige role/tier *(mantido)*.
- `src/routes/auth.ts` — endpoints de auth *(reescrito)*.
- `src/routes/health.ts` — healthcheck.

São 11 arquivos novos. É deliberado: cada um é uma unidade pequena, de propósito
único e testável isolada, em vez de um `auth.ts` de 400 linhas.

## Endpoints

| Método | Rota | Proteção | Descrição |
|---|---|---|---|
| GET | `/health` | — | Liveness. |
| POST | `/webhooks/hotmart` | hottok | Compra e cancelamento. Ver máquina de eventos. |
| POST | `/auth/login` | Turnstile · rate limit | `{ email, senha }` → cookie de sessão. Erro sempre genérico. |
| POST | `/auth/recover` | Turnstile · rate limit · cooldown 5min | `{ email, documento }` → email com link. Resposta sempre 200 genérica. |
| POST | `/auth/set-password` | token de uso único | `{ token, senha }` → grava hash, queima o token, invalida os demais, emite sessão. |
| GET | `/auth/me` | sessão | `{ id, email, name, role, tier }`. |
| POST | `/auth/logout` | — | Limpa o cookie. |

**Cron:** `0 3 * * *` (00:00 BRT) → `jobs/reconcile.ts`.

**Removidos:** `GET /auth/login` (redirect OAuth) e `GET /auth/callback`.

**Fora deste sub-projeto:** `DELETE /auth/me` (sub-projeto 4, junto da sua tela).

## Fluxo do webhook

```
1. Compara X-HOTMART-HOTTOK em tempo constante        → 401 se falhar
2. Valida payload com Zod (tolerante: só o que usamos)
3. Claim de idempotência pelo `id` do evento
   └─ já 'processed' ou 'ignored'?                    → 200, fim
   └─ linha em 'received'? tentativa anterior morreu   → reprocessa
4. data.product.ucode ∈ HOTMART_SUBSCRIPTION_UCODES?  → senão 200 'ignored'
5. Despacha por `event` (tabela abaixo)
6. Marca o evento 'processed'                          → 200
```

O evento só é marcado `processed` no **fim**. Se o envio do email falhar, o Worker
responde 5xx, a Hotmart reenvia e o fluxo reprocessa. Marcar no início
transformaria uma falha de email em aluno pagante sem acesso e sem retentativa.

| Evento | Efeito |
|---|---|
| `PURCHASE_APPROVED` | upsert User + Subscription · `access_until = purchase.date_next_charge` · envia link mágico **apenas se** `password_hash IS NULL`, sem token pendente, `recurrence_number == 1` e email fora da tombstone |
| `PURCHASE_REFUNDED` · `PURCHASE_CHARGEBACK` · `PURCHASE_PROTEST` | `access_until = now` (revoga) |
| `PURCHASE_DELAYED` | `status='DELAYED'`, **preserva** `access_until` |
| `PURCHASE_CANCELED` · `PURCHASE_EXPIRED` | `status='EXPIRED'` se a linha existir; senão nada |
| `PURCHASE_COMPLETE` | apenas registra (fim da garantia) |
| `SUBSCRIPTION_CANCELLATION` | busca por `data.subscriber.code` · `access_until = data.date_next_charge` (ou `now` se ausente/passado) · código desconhecido → `ignored` |

O cancelamento **não** filtra por ucode: o payload não o traz. O casamento pela PK
já garante que a assinatura é nossa.

**Fallback de `date_next_charge`.** O campo é opcional no payload. Se vier ausente
num `PURCHASE_APPROVED`, `access_until` recebe `now + 7 dias` — deliberadamente
curto, porque não temos a periodicidade do plano no payload de compra (só na API de
dados). O cron corrige com o valor real na primeira execução. O erro assim é dar
acesso de menos por até 24h a quem pagou, e não acesso de graça indefinido a quem
não pagou.

Campos consumidos do payload de compra: `id`, `event`, `data.product.ucode`,
`data.buyer.{email,name,document}`,
`data.purchase.{transaction,status,date_next_charge,recurrence_number}`,
`data.subscription.{status,plan.name,subscriber.code}`. Todo o resto — endereço,
telefones, pagamento, comissões — é descartado no parse.

## Modelo de dados (D1 + Drizzle)

Migração única (o banco não tem dados): recria `users` e `subscriptions`, cria
`auth_tokens`, `webhook_events` e `deleted_accounts`.

```
users
  id             TEXT PK                -- uuid local
  email          TEXT NOT NULL UNIQUE   -- normalizado (trim + lowercase)
  name           TEXT NULL              -- saudação dos emails
  document_hash  TEXT NULL              -- HMAC(dígitos, DOCUMENT_HMAC_KEY)
  password_hash  TEXT NULL              -- NULL = nunca definiu senha
  role           TEXT NOT NULL DEFAULT 'user'   -- 'admin' | 'user'
  created_at     INTEGER NOT NULL
  updated_at     INTEGER NOT NULL

subscriptions
  hotmart_subscriber_code  TEXT PK
  user_id                  TEXT NOT NULL → users.id ON DELETE CASCADE  (index)
  product_ucode            TEXT NOT NULL
  plan_name                TEXT NULL
  status                   TEXT NOT NULL      -- auditoria, não decide acesso
  access_until             INTEGER NULL       -- fonte da verdade do acesso
  last_transaction         TEXT NULL
  created_at, updated_at   INTEGER NOT NULL

auth_tokens
  token_hash   TEXT PK              -- SHA-256 do token (32 bytes, base64url)
  user_id      TEXT NOT NULL → users.id ON DELETE CASCADE  (index)
  expires_at   INTEGER NOT NULL     -- 48h primeiro acesso · 1h recuperação
  used_at      INTEGER NULL
  created_at   INTEGER NOT NULL

webhook_events
  id           TEXT PK              -- o `id` do evento Hotmart
  event        TEXT NOT NULL
  status       TEXT NOT NULL        -- 'received' | 'processed' | 'ignored'
  note         TEXT NULL
  received_at  INTEGER NOT NULL

deleted_accounts
  email_hash   TEXT PK              -- HMAC(email, DOCUMENT_HMAC_KEY)
  deleted_at   INTEGER NOT NULL
```

Notas de modelagem:

- **Sem `hotmart_user_id`.** Não existe identidade Hotmart para referenciar. A
  ligação é `email` (pessoa) e `subscriber_code` (assinatura).
- **`auth_tokens` sem coluna `purpose`.** A única diferença entre primeiro acesso
  e recuperação é o TTL, que já vive em `expires_at`; o texto do email é escolhido
  no envio. Nada consumiria a coluna.
- **`webhook_events` não guarda o payload bruto** — é PII em repouso sem caso de
  uso de replay. Também não referencia `users`, então sobrevive à exclusão de
  conta: o rastro de auditoria permanece.
- **`document_hash` é nullable** porque `data.buyer.document` só vem se o checkout
  o solicitar. Quando for nulo, o recover valida apenas o email — invisível para
  atacante (a resposta é genérica de todo modo) e evita trancar cliente pagante
  fora. A providência operacional correspondente é exigir CPF no checkout.

## Reconciliação (cron diário)

```
1. client_credentials → access_token
2. Para cada página (page_token) de GET /subscriptions:
   - filtra pelo produto, com start_date antigo e explícito
3. Para cada assinatura retornada:
   - email na tombstone?                       → pula
   - ausente no D1?                            → cria user + subscription + link mágico
   - date_next_charge divergente?              → corrige access_until
   - status não-ativo ou data no passado?      → revoga
4. Assinatura no D1 e ausente na API           → registra, NÃO revoga
```

Fecha os dois furos que o webhook deixa quando uma entrega falha: **compra
perdida** (aluno pagou e não existe no sistema — único remédio automático, já que
o recover não ajuda quem não existe) e **cancelamento perdido** (ex-assinante com
acesso pago indefinido).

## Segurança

- **Secrets** (`wrangler secret put`): `JWT_SECRET`, `HOTMART_HOTTOK`,
  `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `DOCUMENT_HMAC_KEY`,
  `TURNSTILE_SECRET_KEY`.
- **Vars**: `HOTMART_SUBSCRIPTION_UCODES` (csv), `HOTMART_API_BASE_URL`,
  `HOTMART_TOKEN_URL`, `HOTMART_CHECKOUT_URL`, `APP_BASE_URL`, `EMAIL_FROM`,
  `ADMIN_EMAILS`.
- **Bindings**: `DB` (D1), `EMAIL` (`send_email`).
- **Removidos**: `COOKIE_SIGNING_KEY` (morreu com o state cookie),
  `HOTMART_REDIRECT_URI`, `HOTMART_AUTHORIZE_URL`, `HOTMART_USERINFO_URL`.
  `HOTMART_CLIENT_ID`/`SECRET` **permanecem**, agora para `client_credentials` da
  API de dados — não para OAuth de browser.
- **Webhook**: hottok em tempo constante; Zod tolerante; idempotência; **nunca
  concede `role='admin'`** (o papel vem só de `ADMIN_EMAILS`).
- **Auth**: respostas genéricas em login e recover; token de uso único que
  invalida os demais; cooldown de 5 min; guarda de token pendente; Turnstile em
  login e recover.
- **Rate limit na borda** (Rate Limiting Rules) em `/auth/*` e
  `/webhooks/hotmart` — configuração no dashboard, não código.
- **LGPD**: minimização no parse (só 8 campos persistidos); documento em HMAC;
  **nunca logar o payload** — logs registram apenas `id`, `event` e
  `subscriber_code`. Um `console.log(body)` bem-intencionado joga CPF e endereço
  nos logs e anula o resto.
- **Dados**: queries parametrizadas (Drizzle, sem interpolação); migrações
  versionadas.

`HOTMART_API_BASE_URL` e `HOTMART_TOKEN_URL` são variáveis, e não constantes,
justamente porque os valores de produção **não foram confirmados** — a
documentação da API de dados é renderizada via JS e o sitemap do site está
bloqueado. Confirmado apenas que o sandbox usa base `https://sandbox.hotmart.com`.
Confirmar os valores faz parte do runbook.

## Testes

Vitest + `@cloudflare/vitest-pool-workers` (Miniflare + D1 local). Hotmart, Email
e Turnstile como fakes; nenhuma rede.

**Webhook:** hottok inválido → 401 · ucode fora da lista → `ignored` ·
`PURCHASE_APPROVED` cria user + subscription + envia email · reenvio do mesmo `id`
não duplica nem reenvia · evento em `received` reprocessa · renovação
(`recurrence_number=2`) não reenvia email · `REFUNDED` revoga ·
`SUBSCRIPTION_CANCELLATION` conhecido → `access_until = date_next_charge` · código
desconhecido → `ignored` · payload sem `document` → user criado com
`document_hash` nulo.

**set-password:** token válido → senha gravada + sessão emitida · expirado · já
usado · inexistente · senha < 8 chars · após o uso, os demais tokens do usuário
estão invalidados.

**login:** senha correta · senha errada · usuário com `password_hash` nulo → mesma
resposta genérica · Turnstile reprovado → 403.

**recover:** dados corretos → token + email · email inexistente → 200 sem token ·
documento errado → 200 sem token · segunda chamada dentro de 5 min → 200 sem token
novo · usuário sem `document_hash` → valida só o email · email na tombstone → 200
sem token.

**reconcile:** assinatura na API ausente no D1 → cria user + envia link ·
`date_next_charge` divergente → corrige · status cancelado → revoga ·
**assinatura no D1 ausente na API → nada muda** · paginação percorre todas as
páginas · email na tombstone → pula.

**tombstone:** renovação com email na tombstone → `ignored` · nova compra
(`recurrence_number=1`) limpa a tombstone e provisiona.

**entitlement:** `access_until` futuro → assinante · passado → gratuito · duas
assinaturas, uma válida → assinante.

**cascata:** `DELETE FROM users` remove tokens e assinaturas do usuário.

**Mantidos:** `lib/jwt` (sign/verify, expirado, assinatura inválida),
`lib/cookies`, `middleware/rbac`.

**Manual/sandbox (runbook):** compra real no sandbox → webhook recebido → email
recebido → definir senha → login → `/auth/me` com `tier=assinante`; cancelamento →
`access_until` ajustado; e **conferência dos fixtures contra o payload real**, já
que os atuais são derivados da documentação. Confirmar também o host e o token URL
da API de dados.

## Remoção do código de OAuth

**Deletados:** `src/lib/hotmart.ts` (cliente OAuth inteiro) · `test/hotmart.test.ts`
· rotas `GET /auth/login` e `GET /auth/callback` · helpers de state cookie
(`setStateCookie`, `getStateCookie`, `clearStateCookie`) · `COOKIE_SIGNING_KEY` ·
coluna `users.hotmart_user_id` · tipo `HotmartIdentity`.

**Reescritos:** `src/routes/auth.ts` · `src/db/users.ts` · `src/db/schema.ts` ·
`src/config/env.ts` · `src/lib/cookies.ts` · `test/auth-routes.test.ts` ·
`test/users.test.ts` · `test/db.test.ts`.

**Mantidos sem alteração:** `src/lib/jwt.ts` · `src/middleware/session.ts` ·
`src/middleware/rbac.ts` · `src/db/client.ts` · `src/routes/health.ts`.

## Dependências operacionais (bloqueiam a implementação)

Não são código e precisam estar prontas antes das tarefas correspondentes:
webhook configurado na Hotmart (URL, eventos, versão 2.0.0) e **hottok** obtido ·
**CPF exigido no checkout** · **DNS do domínio de envio** (SPF/DKIM) para o Email
Sending · `client_id`/`client_secret` da API de dados · **ucodes** dos produtos de
assinatura confirmados · chaves do **Turnstile** · **Rate Limiting Rules** no
dashboard.

## Fora de escopo (Fundação)

Frontend e todas as telas (login, definir senha, recuperar acesso, excluir conta);
widget Turnstile; `DELETE /auth/me`; KV; refresh token; portal de gestão de
assinatura; e todas as demais tabelas do ERD (Question, Alternative, Explanation,
Attempt, Comment, Note, Favorite, taxonomias). CI/CD: apenas scripts locais
(`npm test`, `wrangler deploy` manual) — GitHub Actions adiado.

## Stack

TypeScript, Hono, Drizzle ORM + drizzle-kit, Zod, Wrangler, Vitest
(`@cloudflare/vitest-pool-workers`), WebCrypto (PBKDF2, HMAC, SHA-256), Cloudflare
Email Sending (binding `send_email`), Turnstile.
