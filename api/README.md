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

## Verificação manual

A suíte automatizada usa fixtures derivados da documentação da Hotmart, não de
tráfego real. Antes de considerar a Fundação pronta, rodar
[`docs/runbook-verificacao-hotmart.md`](../docs/runbook-verificacao-hotmart.md)
contra o sandbox.

Dois valores estão marcados como **não confirmados** e são o primeiro item do
runbook: o caminho da API de dados (`src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL` (`wrangler.jsonc`).
