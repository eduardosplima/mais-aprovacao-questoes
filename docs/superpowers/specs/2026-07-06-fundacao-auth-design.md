# Fundação — Auth, Sessão e Base de Dados (design)

> Sub-projeto 1 de 5 da plataforma **Mais Aprovação Questões**. Companion da
> `docs/especificacao-tecnica.md`. Escopo: **backend apenas** (Worker), sem frontend.

## Contexto e decomposição

A plataforma foi decomposta em cinco sub-projetos, cada um com seu próprio ciclo
spec → plano → implementação:

1. **Fundação (este documento)** — setup Cloudflare Worker, modelo de dados +
   migrações, login Hotmart OAuth, sessão JWT, RBAC, segredos.
2. Admin & conteúdo — painel admin, cadastro de questões + taxonomias.
3. Núcleo de estudo — responder/correção, cota freemium (Durable Objects),
   gabarito comentado, comentários, anotações, favoritos.
4. Assinatura — webhook Hotmart, máquina de estados de `Subscription`, cron de
   reconciliação.
5. Frontend do aluno — experiência da `docs/demo.html`, responsivo + PWA + SEO.

Este spec cobre **apenas o sub-projeto 1**.

## Objetivo e critério de sucesso

Um único Cloudflare Worker (TypeScript + Hono) em `api/` que permite a um usuário
autenticar via Hotmart OAuth 2.0 e obter uma sessão validada em cada request, com
papéis (RBAC) e migrações de banco versionadas.

**Pronto quando:**
- Os endpoints de auth funcionam de ponta a ponta contra o **sandbox da Hotmart**
  (verificado manualmente via browser/curl, roteiro documentado).
- A suíte Vitest passa cobrindo os caminhos de auth (sucesso e falhas) com o
  cliente Hotmart mockado.
- Migrações de `User` e `Subscription` aplicam num D1 local.

Sem CI, sem frontend, sem KV — ver "Fora de escopo".

## Decisões-chave

### Sessão: JWT stateless em cookie (definitivo)
A sessão é um **JWT assinado em cookie HttpOnly/Secure/SameSite=Lax**. Este é o
modelo definitivo (Workers são stateless; o cookie é onde a sessão mora). O JWT
carrega apenas a **identidade** (`sub` = user id). `role` e o tier efetivo são
**relidos do D1 a cada request protegido** — D1 é a fonte da verdade, o que
permite revogar acesso sem esperar o token expirar.

**Nota sobre KV — adiado, não é armazenamento de sessão.** Na Fundação o
entitlement vem direto do D1, através de uma função única `loadEntitlement(userId)`.
KV pode, no futuro, entrar como *cache de leitura* na frente do D1 nessa função
(lê do KV, cai pro D1 no miss) — otimização localizada, sem mudar endpoints nem o
formato do cookie. KV entra de verdade no roadmap no sub-projeto 3, para cache das
questões (tráfego read-heavy). Não faz falta na Fundação.

### Estado anti-CSRF do OAuth: cookie assinado, não KV
O `state` do fluxo OAuth é guardado num **cookie HttpOnly assinado de curta
duração (~10 min)**, comparado no callback. Mantém o fluxo stateless e sem
dependência de KV.

### Refresh token: adiado
Sem frontend não há quem faça refresh silencioso. A sessão dura ~7 dias; rotação e
refresh entram junto com o sub-projeto de frontend. Aceitável porque a revogação
efetiva já vem do re-read de entitlement no D1.

### Papéis: `role ∈ {admin, user}` + tier derivado
`User.role` é `admin` ou `user`. O **tier** efetivo (`assinante` / `gratuito`) é
**derivado** de `Subscription.status`, não é uma terceira coluna. `admin` é
concedido via **allowlist de e-mails** no seed (nunca via webhook, conforme a
seção 5 da spec técnica). Os três valores de RBAC da spec (`admin`, `assinante`,
`gratuito`) passam a ser: `admin` (role) e `assinante`/`gratuito` (tier derivado).

### Cliente Hotmart injetável
Uma interface `HotmartClient` com implementação real (contra o sandbox) e um mock
para os testes. Rede fica fora dos unit tests; o fluxo real é exercitado
manualmente contra o sandbox.

## Arquitetura / layout (`api/`)

Hono app com módulos focados, cada um com propósito único:

- `src/index.ts` — bootstrap do Hono, registro de rotas e middlewares globais.
- `src/config/env.ts` — leitura/validação (Zod) das bindings e secrets.
- `src/db/schema.ts` — schema Drizzle (`User`, `Subscription`).
- `src/db/migrations/` — migrações versionadas (drizzle-kit).
- `src/lib/jwt.ts` — assinar/verificar o JWT de sessão.
- `src/lib/cookies.ts` — set/clear de cookies assinados (state e sessão).
- `src/lib/hotmart.ts` — interface `HotmartClient` + impl real (token exchange,
  identidade) + factory.
- `src/middleware/session.ts` — extrai/valida o JWT, popula o contexto.
- `src/middleware/rbac.ts` — exige role/tier; `loadEntitlement(userId)` (ponto
  único de re-read do D1).
- `src/routes/auth.ts` — os endpoints de auth.
- `src/routes/health.ts` — healthcheck.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Liveness simples. |
| GET | `/auth/login` | Gera `state`, seta cookie de state assinado, redireciona ao authorize da Hotmart (`client_id`, `redirect_uri`, `state`). |
| GET | `/auth/callback` | Valida `state` (cookie vs query), troca `code` por `access_token` server-side, busca identidade (e-mail/id), upsert `User`, garante `Subscription` placeholder, emite cookie de sessão JWT. |
| GET | `/auth/me` | Protegido. Retorna `{ id, email, role, tier }`. |
| POST | `/auth/logout` | Limpa o cookie de sessão. |

Erros de callback (state ausente/divergente, troca de code falha) retornam 4xx sem
criar sessão.

## Modelo de dados (D1 + Drizzle)

Migrações versionadas; apenas o necessário para auth.

```
User {
  id            text PK        // gerado localmente (uuid)
  email         text UNIQUE NOT NULL
  hotmart_user_id text UNIQUE
  role          text NOT NULL DEFAULT 'user'   // 'admin' | 'user'
  created_at    timestamp NOT NULL
}

Subscription {
  user_id                   text PK FK -> User.id
  hotmart_subscriber_code   text NULL
  plan                      text NULL
  status                    text NOT NULL DEFAULT 'none'  // placeholder; ACTIVE/CANCELLED/... no sub-projeto 4
  current_period_end        timestamp NULL
}
```

`status` guarda o **estado da assinatura** (não o tier). Na Fundação o único valor
é o placeholder `'none'` (= sem assinatura); os valores reais (`ACTIVE`,
`DELAYED`, `CANCELLED`, `REFUNDED`, …) chegam no sub-projeto 4. O **tier** é
derivado por `loadEntitlement`: `assinante` quando `status` é ativo (`ACTIVE`),
`gratuito` caso contrário (inclusive `'none'`).

No login: upsert de `User` (role vem da allowlist de admin, senão `user`) e
garantia de uma linha `Subscription` com `status='none'`. O status real de
assinatura é responsabilidade do sub-projeto 4 (webhook + reconciliação) — aqui é
só placeholder.

## Segurança

- **Secrets** (via `wrangler secret`, nunca em código): `HOTMART_CLIENT_ID`,
  `HOTMART_CLIENT_SECRET`, `JWT_SECRET`, `COOKIE_SIGNING_KEY`.
- **Sessão:** cookie HttpOnly/Secure/SameSite=Lax; JWT assinado, exp ~7 dias.
- **OAuth:** `state` obrigatório (anti-CSRF); troca de `code` server-side (secret
  nunca vai ao browser).
- **RBAC:** checado no Worker via middleware; entitlement relido do D1.
- **Dados:** queries parametrizadas (Drizzle — sem interpolação de string);
  migrações versionadas.
- **Turnstile:** adiado — é widget de frontend, entra no sub-projeto 5.

## Testes

- **Unit/integração** com Vitest + `@cloudflare/vitest-pool-workers` (Miniflare +
  D1 local):
  - `lib/jwt`: sign/verify, token expirado, assinatura inválida.
  - state: gerar/validar; divergência e ausência rejeitadas.
  - `middleware/rbac`: exige role; `loadEntitlement` deriva tier de
    `Subscription.status`.
  - upsert de `User`: cria e atualiza; role de admin via allowlist.
  - `/auth/callback` com `HotmartClient` mockado: sucesso; state inválido; code
    inválido; e-mail admin vs comum.
- **Manual/sandbox:** roteiro documentado do login real (browser/curl) contra o
  sandbox da Hotmart.

## Fora de escopo (Fundação)

Frontend, Turnstile, webhook/reconciliação de assinatura (só placeholder de
status), KV, refresh token, e todas as demais tabelas do ERD (Question,
Alternative, Explanation, Attempt, Comment, Note, Favorite, taxonomias). CI/CD:
apenas scripts locais (`npm test`, `wrangler deploy` manual) — GitHub Actions
adiado.

## Stack

TypeScript, Hono, Drizzle ORM + drizzle-kit, Zod, Wrangler, Vitest
(`@cloudflare/vitest-pool-workers`).
