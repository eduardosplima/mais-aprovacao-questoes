# Mais Aprovação — API (Fundação)

Backend em **Cloudflare Workers** (TypeScript + Hono) da plataforma Mais Aprovação
Questões. Este módulo é a **Fundação**: autenticação por senha + link mágico
(sem self-signup — a conta só nasce da compra na Hotmart), sessão JWT, webhook
de compra/cancelamento, reconciliação diária contra a API de dados da Hotmart
e base de dados (D1). Sem frontend.

## Stack

TypeScript · Hono · Drizzle ORM (D1/SQLite) · jose (JWT) · Zod · Wrangler ·
Vitest (`@cloudflare/vitest-pool-workers`).

## Setup local

```bash
cd api
npm install
```

> **Nota de ambiente (macOS + Homebrew libvips):** se `npm install` falhar no
> postinstall do `sharp` (dependência transitiva do Miniflare), rode uma vez com
> `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install` — isso força o binário pré-compilado
> do sharp em vez de compilar contra a libvips global do Homebrew. Não muda
> versões nem arquivos.

### Segredos (`.dev.vars`)

Crie `api/.dev.vars` (já no `.gitignore` — **nunca** commitar) com os seis
segredos abaixo, valores do **sandbox da Hotmart** onde aplicável:

```
JWT_SECRET=<segredo forte para assinar o cookie de sessão>
HOTMART_HOTTOK=<hottok do painel Hotmart → Ferramentas → Webhook, sandbox>
HOTMART_CLIENT_ID=<client_id da API de dados do sandbox>
HOTMART_CLIENT_SECRET=<client_secret da API de dados do sandbox>
DOCUMENT_HMAC_KEY=<segredo forte — pepper do HMAC de CPF e do email da tombstone>
TURNSTILE_SECRET_KEY=<secret key do Turnstile (par com a site key do frontend)>
```

As demais variáveis, não-secretas, já vêm de `wrangler.jsonc` (bloco `vars`):
`HOTMART_SUBSCRIPTION_UCODES`, `HOTMART_API_BASE_URL`, `HOTMART_TOKEN_URL`,
`HOTMART_CHECKOUT_URL`, `APP_BASE_URL`, `EMAIL_FROM`, `ADMIN_EMAILS`. Ajuste os
placeholders (`REPLACE_ME`) ali antes de rodar contra o sandbox. Em produção,
os seis segredos vão via `wrangler secret put <NOME>`; as vars continuam em
`wrangler.jsonc`.

Opcional e só de desenvolvimento: `ACCESS_DEV_BYPASS=true` em `.dev.vars` pula
a verificação do Cloudflare Access em `/admin/*` (ver seção "Painel
administrativo"). Nunca definir em produção.

`ADMIN_EMAILS` é uma lista separada por vírgula; e-mails nela recebem
`role=admin` na compra (webhook) ou na reconciliação — nunca a partir do
payload em si.

## Rodar

```bash
npm run db:migrate:local   # aplica migrações no D1 local
npm run dev                # sobe o Worker em http://localhost:8787
```

## Testes

```bash
npm test                   # Vitest (Miniflare + D1 local); rede mockada
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Liveness → `{ ok: true }` |
| POST | `/auth/login` | `{ email, password, turnstileToken }` → valida credenciais e seta cookie de sessão |
| POST | `/auth/set-password` | `{ token, password }` → consome o token do link mágico, define a senha e seta cookie de sessão |
| POST | `/auth/recover` | `{ email, document, turnstileToken }` → sempre `200 { ok: true }`; só envia o link de recuperação se email+CPF baterem |
| GET | `/auth/me` | Protegido. Retorna `{ id, email, name, role, tier }` |
| POST | `/auth/logout` | Limpa o cookie de sessão |
| POST | `/webhooks/hotmart` | Recebe eventos de compra/cancelamento da Hotmart (autenticado pelo header `x-hotmart-hottok`) |
| GET | `/admin/taxonomy?kind=` | Lista termos de uma taxonomia (`subject`, `banca`, `cargo`, `level`) |
| POST | `/admin/taxonomy` | `{ kind, name }` → cria termo. 409 se já existir ativo |
| PATCH | `/admin/taxonomy/:id` | `{ name }` → renomeia recalculando o slug. 409 se colidir com outro termo ativo do mesmo kind |
| DELETE | `/admin/taxonomy/:id` | Soft delete |
| GET | `/admin/questions` | Lista paginada com filtros (`subjectId`, `bancaId`, `year`, `status`…). Filtro inválido → 400 com o código do campo; `limit`/`offset` inválidos caem no default |
| POST | `/admin/questions` | Cria a questão inteira; `status` opcional (`draft` por default) publica no mesmo envio. 422 com código quando viola invariante |
| GET | `/admin/questions/:id` | Questão com alternativas e gabarito |
| PATCH | `/admin/questions/:id` | Edita — publicada ou não, o id nunca muda |
| POST | `/admin/questions/:id/publish` · `/unpublish` | Alterna o `status` |
| DELETE | `/admin/questions/:id` | Soft delete |
| POST | `/admin/media` | `multipart/form-data` com `file` → `{ url }` no R2 |

Sessão: JWT (HS256) em cookie `HttpOnly; Secure; SameSite=Lax; Path=/`. A
identidade vai no `sub`; `role`/`tier` são relidos do D1 a cada request —
`tier` é derivado só de `subscriptions.access_until > now`, nunca do JWT.

Não há cadastro público: a conta só nasce pela compra na Hotmart (webhook) ou
pela reconciliação diária quando o webhook se perde; o primeiro acesso e a
recuperação de senha acontecem exclusivamente pelo link mágico enviado por
email.

## Webhook e reconciliação

`POST /webhooks/hotmart` (`src/webhooks/hotmart.ts`) processa `PURCHASE_APPROVED`,
`PURCHASE_DELAYED`, `PURCHASE_CANCELED`/`PURCHASE_EXPIRED`,
`PURCHASE_REFUNDED`/`PURCHASE_CHARGEBACK`/`PURCHASE_PROTEST` e
`SUBSCRIPTION_CANCELLATION`; é idempotente por `id` do evento (reenvios com o
mesmo `id` devolvem `{ ok: true, duplicate: true }` sem reprocessar).

O cron `0 3 * * *` (`wrangler.jsonc` → `triggers.crons`) roda `reconcile()`
(`src/jobs/reconcile.ts`), que compara o D1 com a API de dados da Hotmart:
cria assinaturas cujo webhook se perdeu e corrige/revoga acesso divergente.
Regra dura: ausência na listagem da API **nunca** revoga — só status/data
explícitos revogam.

## Bindings e triggers (`wrangler.jsonc`)

- `DB` — D1 (`mais-aprovacao-db`), migrações em `migrations/`.
- `EMAIL` — `send_email`, usado para o link mágico (primeiro acesso e recuperação).
- `triggers.crons` — `0 3 * * *`, dispara a reconciliação diária.

## Camada de dados (`src/db/`)

Módulos de acesso a dados sem rotas HTTP próprias, consumidos pelas rotas do
painel administrativo. `taxonomy.ts` cobre assunto/banca/cargo/nível (CRUD com
soft delete); `questions.ts` cobre questões, alternativas e gabarito, com as
invariantes que o SQLite não impõe (uma alternativa correta, contagem por
tipo, FK de taxonomia no `kind` certo) validadas antes de qualquer escrita.

Escritas que tocam várias linhas relacionadas (ex.: substituir as alternativas
de uma questão) usam `db.batch()` em vez de `.run()` sequenciais — o D1
executa o array inteiro numa transação implícita, então uma falha no meio não
deixa a tabela num estado parcial. Convenção adotada a partir da Task 4;
módulos futuros (tentativas, comentários, anotações) devem seguir o mesmo
padrão.

## Painel administrativo

`/admin/*` tem **duas camadas independentes**, e nenhuma confia na outra:

1. **Cloudflare Access** na borda — identidade e MFA no IdP (Google/GitHub).
   O Worker valida o header `Cf-Access-Jwt-Assertion` contra o JWKS público do
   time (`src/middleware/access.ts`).
2. **Sessão + RBAC** — `requireSession` e `requireAdmin`, lendo `role` do D1.

O email do JWT do Access **não** identifica o usuário na aplicação: por isso
são duas camadas e não uma. Consequência prática: o admin autentica duas vezes.

Em desenvolvimento nada passa pela borda da Cloudflare, então o header não
existe. `ACCESS_DEV_BYPASS=true` em `.dev.vars` pula a camada 1 — e **só** a
string exata `true` pula. A variável nunca vai para produção; o login com senha
e o `role=admin` continuam valendo em dev.

Conteúdo HTML (enunciado, alternativas, gabarito) é sanitizado **na escrita**
por `src/lib/sanitizeHtml.ts`, com `HTMLRewriter` nativo. Allowlist de tags e
atributos mais validação do esquema das URLs — permitir o atributo `href` não
diz nada sobre o valor dele, e `javascript:` passaria sem essa checagem.

Questões e taxonomias usam **soft delete**. O filtro de `deleted_at` vive
exclusivamente em `src/db/questions.ts` e `src/db/taxonomy.ts`; nenhuma rota
monta query direto.

## Verificação manual

A suíte automatizada usa fixtures derivados da documentação da Hotmart, não de
tráfego real. Antes de considerar a Fundação pronta, rodar
[`docs/runbook-verificacao-hotmart.md`](../docs/runbook-verificacao-hotmart.md)
contra o sandbox.

Dois valores estão marcados como **não confirmados** e são o primeiro item do
runbook: o caminho da API de dados (`src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL` (`wrangler.jsonc`).
