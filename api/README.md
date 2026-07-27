# Mais Aprovação — API (Fundação)

Backend em **Cloudflare Workers** (TypeScript + Hono) da plataforma Mais Aprovação
Questões. Este módulo é a **Fundação**: login via Hotmart OAuth 2.0, sessão JWT,
RBAC e base de dados (D1). Sem frontend.

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

Crie `api/.dev.vars` (já no `.gitignore` — **nunca** commitar) com os valores do
**sandbox da Hotmart**:

```
JWT_SECRET=<segredo forte p/ assinar o JWT>
COOKIE_SIGNING_KEY=<segredo forte p/ assinar o cookie de state>
ADMIN_EMAILS=seu-email-admin@dominio.com
HOTMART_CLIENT_ID=<client_id do app OAuth>
HOTMART_CLIENT_SECRET=<client_secret do app OAuth>
HOTMART_REDIRECT_URI=http://localhost:8787/auth/callback
HOTMART_AUTHORIZE_URL=<url de authorize do sandbox>
HOTMART_TOKEN_URL=<url de token do sandbox>
HOTMART_USERINFO_URL=<url de userinfo do sandbox>
```

`ADMIN_EMAILS` é uma lista separada por vírgula; e-mails nela recebem `role=admin`
no login. Em produção, os mesmos segredos vão via `wrangler secret put <NOME>`.

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
| GET | `/auth/login` | Gera `state`, seta cookie assinado, redireciona ao authorize da Hotmart |
| GET | `/auth/callback` | Valida `state`, troca `code` por token (server-side), upsert do usuário, emite cookie de sessão |
| GET | `/auth/me` | Protegido. Retorna `{ id, email, role, tier }` |
| POST | `/auth/logout` | Limpa o cookie de sessão |

Sessão: JWT (HS256) em cookie `HttpOnly; Secure; SameSite=Lax; Path=/`. A
identidade vai no `sub`; `role`/`tier` são relidos do D1 a cada request.

## Verificação manual contra o sandbox

Com o `.dev.vars` preenchido e o Worker rodando (`npm run dev`):

1. Acesse `http://localhost:8787/auth/login` no navegador.
2. Faça login no **sandbox da Hotmart** e autorize.
3. O callback deve retornar `{ ok: true }` e setar o cookie `session` (sem erro
   de `invalid_state`).
4. `GET http://localhost:8787/auth/me` deve retornar seu `{ id, email, role, tier }`
   — `role: "admin"` se o e-mail estiver em `ADMIN_EMAILS`, senão `"user"`;
   `tier: "gratuito"` (sem assinatura ativa nesta fase).

> **Ajuste de mapeamento:** se `/auth/me` vier com `email` vazio ou `id`
> inesperado, a resposta real do `HOTMART_USERINFO_URL` difere do mapeamento em
> `src/lib/hotmart.ts` (`data.id ?? data.user_id`, `data.email`). Inspecione a
> resposta real e ajuste o mapeamento, depois rode `npm test`.

## Fora do escopo da Fundação

Frontend, Turnstile, webhook/reconciliação de assinatura (status é placeholder
`none`), KV, refresh token, demais tabelas do ERD e CI/CD. Entram nos
sub-projetos seguintes.

## Verificação manual

A suíte automatizada usa fixtures derivados da documentação da Hotmart, não de
tráfego real. Antes de considerar a Fundação pronta, rodar
[`docs/runbook-verificacao-hotmart.md`](../docs/runbook-verificacao-hotmart.md)
contra o sandbox.

Dois valores estão marcados como **não confirmados** e são o primeiro item do
runbook: o caminho da API de dados (`src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL` (`wrangler.jsonc`).
