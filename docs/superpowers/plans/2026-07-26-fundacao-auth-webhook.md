# Fundação — Auth própria + Webhook Hotmart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer com que uma compra aprovada na Hotmart crie a conta do aluno e lhe envie um link para definir senha, e que o aluno autentique com email e senha obtendo uma sessão validada a cada request.

**Architecture:** Um Cloudflare Worker (Hono) em `api/`. O webhook da Hotmart é o único criador de contas — não há autocadastro. O acesso é decidido por uma única comparação de data (`subscriptions.access_until > now`); o `status` da assinatura é auditoria e nunca entra na autorização. Um cron diário reconcilia contra a API de dados da Hotmart e nunca revoga por ausência.

**Tech Stack:** TypeScript, Hono 4.12, Drizzle ORM 0.45 + drizzle-kit, Zod 4, jose (JWT), Wrangler 4, Vitest 4 + `@cloudflare/vitest-pool-workers`, WebCrypto (PBKDF2/HMAC/SHA-256), Cloudflare Email Sending (binding `send_email`), Turnstile.

**Spec:** `docs/superpowers/specs/2026-07-06-fundacao-auth-design.md`

## Global Constraints

- **Diretório de trabalho:** todos os comandos rodam em `api/`.
- **Timestamps:** todas as colunas de data usam Drizzle `integer(..., { mode: "timestamp_ms" })`. A Hotmart envia datas em **milissegundos** desde a época — usar `timestamp_ms` elimina conversão e o risco de confundir segundos com ms.
- **Normalização de email:** sempre `trim().toLowerCase()` antes de gravar ou comparar. Nunca comparar email cru.
- **Normalização de documento:** sempre `replace(/\D/g, "")` (só dígitos) antes do HMAC.
- **Nunca logar o payload do webhook.** Logs registram apenas `id` do evento, `event` e `subscriber_code`. Um `console.log(body)` joga CPF e endereço nos logs.
- **O webhook nunca concede `role: "admin"`.** O papel vem exclusivamente da allowlist `ADMIN_EMAILS`.
- **Respostas genéricas:** `/auth/login` responde sempre `401 {"error":"invalid_credentials"}` e `/auth/recover` responde sempre `200 {"ok":true}`, independente de o usuário existir.
- **Senha mínima:** 8 caracteres. Sem regras de composição.
- **PBKDF2:** 100.000 iterações, SHA-256, salt de 16 bytes, formato armazenado `pbkdf2$sha256$<iterações>$<salt_b64>$<hash_b64>`.
- **TTL de tokens:** primeiro acesso 48h (`172800000` ms), recuperação 1h (`3600000` ms), cooldown de recuperação 5min (`300000` ms).
- **`lib/hotmartApi.ts` é somente leitura.** Não pode conter nem exportar nenhuma função de cancelamento. A escrita (`cancelSubscription`) ships no sub-projeto 4, em `lib/hotmartCancel.ts`. Há um teste que trava essa invariante.
- **Commits:** um por tarefa, mensagem em português no formato `<tipo>(<escopo>): <descrição>`.
- **Verificação por tarefa:** `npm test` e `npm run typecheck` devem passar antes de commitar.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/app.ts` | **novo** — monta o Hono e as rotas. Existe separado de `index.ts` para que os testes importem o app sem o handler `scheduled`. |
| `src/index.ts` | **reescrito** — entrypoint do Worker: `fetch` + `scheduled`. |
| `src/config/env.ts` | **reescrito** — interface `Env`, `EmailSender`, parsing de `ADMIN_EMAILS` e `HOTMART_SUBSCRIPTION_UCODES`. |
| `src/db/schema.ts` | **reescrito** — 5 tabelas com ações de exclusão declaradas. |
| `src/db/users.ts` | **reescrito** — upsert por email, `loadEntitlement`, `setPasswordHash`. |
| `src/db/subscriptions.ts` | **novo** — upsert por `subscriber_code`, revogação, ajuste de `access_until`. |
| `src/db/authTokens.ts` | **novo** — criar, consumir, checar pendência e cooldown. |
| `src/db/webhookEvents.ts` | **novo** — claim de idempotência e marcação de status. |
| `src/db/deletedAccounts.ts` | **novo** — tombstone: checar, gravar, limpar. |
| `src/lib/constantTime.ts` | **novo** — comparação em tempo constante (hottok e hash de senha). |
| `src/lib/hmac.ts` | **novo** — normalização + HMAC-SHA256 (documento e email). |
| `src/lib/password.ts` | **novo** — hash/verify PBKDF2. |
| `src/lib/tokens.ts` | **novo** — geração do token opaco e seu SHA-256. |
| `src/lib/email.ts` | **novo** — templates e envio do link mágico via `env.EMAIL`. |
| `src/lib/turnstile.ts` | **novo** — verificação `siteverify`. |
| `src/lib/hotmartApi.ts` | **novo** — `client_credentials` + `listSubscriptions` paginado. **Somente leitura.** |
| `src/lib/cookies.ts` | **enxugado** — só o cookie de sessão. |
| `src/webhooks/hotmart.ts` | **novo** — rota, schema Zod e despacho de eventos. |
| `src/jobs/reconcile.ts` | **novo** — o cron de reconciliação. |
| `src/routes/auth.ts` | **reescrito** — login, set-password, recover, me, logout. |
| `src/lib/hotmart.ts` | **DELETADO** — cliente OAuth. |
| `test/helpers.ts` | **novo** — `fakeEmailSender()`, `envWith()`, `cookieFrom()`. |
| `test/fixtures/hotmart.ts` | **novo** — construtores de payload de webhook. |

---

### Task 1: Remover o OAuth e reconfigurar o ambiente

Tarefa de demolição: sai todo o código de OAuth, entra a nova `Env` e a configuração (bindings, vars, cron). Não há teste novo a escrever — o critério é a suíte remanescente verde e o typecheck limpo com a superfície de OAuth inexistente. O split `app.ts`/`index.ts` acontece aqui para evitar churn nos testes nas tarefas seguintes.

**Files:**
- Delete: `src/lib/hotmart.ts`, `test/hotmart.test.ts`, `test/auth-routes.test.ts`, `test/users.test.ts`, `test/db.test.ts`
- Create: `src/app.ts`
- Modify: `src/index.ts`, `src/config/env.ts`, `src/lib/cookies.ts`, `src/routes/auth.ts`, `wrangler.jsonc`, `vitest.config.ts`, `test/cookies.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `interface Env`, `interface EmailSender`, `interface EmailMessage`, `getAdminEmails(env): string[]`, `getSubscriptionUcodes(env): string[]` de `src/config/env.ts`; `app` (default e named export) de `src/app.ts`.

- [ ] **Step 1: Deletar o cliente OAuth e os testes da superfície removida**

```bash
cd api
rm src/lib/hotmart.ts test/hotmart.test.ts test/auth-routes.test.ts test/users.test.ts test/db.test.ts
```

`test/auth-routes.test.ts`, `test/users.test.ts` e `test/db.test.ts` testam comportamento que deixa de existir (callback OAuth, `hotmartUserId`, schema antigo). Serão reescritos nas tarefas 2, 4 e 13.

- [ ] **Step 2: Reescrever `src/config/env.ts`**

```typescript
import type { D1Database } from "@cloudflare/workers-types";

/** Uma mensagem para o Cloudflare Email Sending. */
export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * O binding `send_email`. Declarado como interface nossa (e não com o tipo
 * `SendEmail` do Cloudflare) para que os testes possam injetar um fake via
 * `{ ...env, EMAIL: fake }` sem depender de suporte do Miniflare.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  EMAIL: EmailSender;
  JWT_SECRET: string;
  HOTMART_HOTTOK: string;
  HOTMART_CLIENT_ID: string;
  HOTMART_CLIENT_SECRET: string;
  DOCUMENT_HMAC_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  HOTMART_SUBSCRIPTION_UCODES: string;
  HOTMART_API_BASE_URL: string;
  HOTMART_TOKEN_URL: string;
  HOTMART_CHECKOUT_URL: string;
  APP_BASE_URL: string;
  EMAIL_FROM: string;
  ADMIN_EMAILS: string;
}

function csv(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getAdminEmails(env: Env): string[] {
  return csv(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
}

export function getSubscriptionUcodes(env: Env): string[] {
  return csv(env.HOTMART_SUBSCRIPTION_UCODES);
}
```

- [ ] **Step 3: Enxugar `src/lib/cookies.ts` (remover o state cookie)**

```typescript
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const SESSION = "session";

const base = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION, token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION, { path: "/" });
}
```

- [ ] **Step 4: Reduzir `src/routes/auth.ts` a um esqueleto sem OAuth**

As rotas reais entram nas tarefas 12–14. Aqui só sobra o que não depende de nada removido.

```typescript
import { Hono } from "hono";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { clearSessionCookie } from "../lib/cookies";
import { requireSession } from "../middleware/session";

export const auth = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

// `name` entra na resposta na Task 4, junto com o campo em `Entitlement`.
auth.get("/me", requireSession, (c) => {
  const ent = c.get("entitlement");
  return c.json({
    id: ent.userId,
    email: ent.email,
    role: ent.role,
    tier: ent.tier,
  });
});

auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Criar `src/app.ts` e reescrever `src/index.ts`**

`src/app.ts`:

```typescript
import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

export default app;
```

`src/index.ts`:

```typescript
import app from "./app";

export default {
  fetch: app.fetch,
};
```

- [ ] **Step 6: Atualizar `test/cookies.test.ts` para não referenciar o state cookie**

Abrir o arquivo e remover qualquer `describe`/`it` que use `setStateCookie`, `getStateCookie` ou `clearStateCookie`. Manter os testes de `setSessionCookie` / `getSessionCookie` / `clearSessionCookie`. Se o arquivo importava `app` de `../src/index`, trocar para `../src/app`.

- [ ] **Step 7: Atualizar `wrangler.jsonc`**

`database_id` permanece com o placeholder — a conta real ainda não foi criada, e o deploy não é escopo desta fase.

```jsonc
{
  "name": "mais-aprovacao-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mais-aprovacao-db",
      "database_id": "REPLACE_WITH_REAL_ID_BEFORE_DEPLOY",
      "migrations_dir": "migrations"
    }
  ],
  "send_email": [
    {
      "name": "EMAIL"
    }
  ],
  "triggers": {
    "crons": ["0 3 * * *"]
  },
  "vars": {
    "HOTMART_SUBSCRIPTION_UCODES": "REPLACE_WITH_REAL_UCODES",
    "HOTMART_API_BASE_URL": "https://sandbox.hotmart.com",
    "HOTMART_TOKEN_URL": "https://sandbox.hotmart.com/security/oauth/token",
    "HOTMART_CHECKOUT_URL": "https://pay.hotmart.com/REPLACE_ME",
    "APP_BASE_URL": "http://localhost:3000",
    "EMAIL_FROM": "nao-responda@REPLACE_ME",
    "ADMIN_EMAILS": ""
  }
}
```

> `HOTMART_API_BASE_URL` e `HOTMART_TOKEN_URL` estão apontando para o sandbox com caminhos **não confirmados** (a documentação da API de dados é renderizada via JS). Confirmar na Task 17 (runbook). São variáveis justamente para trocar sem alterar código.

- [ ] **Step 8: Atualizar `vitest.config.ts` com os novos bindings**

```typescript
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          JWT_SECRET: "test-jwt-secret",
          HOTMART_HOTTOK: "test-hottok",
          HOTMART_CLIENT_ID: "cid",
          HOTMART_CLIENT_SECRET: "csecret",
          DOCUMENT_HMAC_KEY: "test-hmac-key",
          TURNSTILE_SECRET_KEY: "test-turnstile-secret",
          HOTMART_SUBSCRIPTION_UCODES: "UCODE_ASSINATURA,UCODE_ANUAL",
          HOTMART_API_BASE_URL: "https://hotmart.test",
          HOTMART_TOKEN_URL: "https://hotmart.test/token",
          HOTMART_CHECKOUT_URL: "https://pay.hotmart.test/produto",
          APP_BASE_URL: "https://app.test",
          EMAIL_FROM: "nao-responda@app.test",
          ADMIN_EMAILS: "admin@test.com",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
```

> **Risco conhecido:** não está confirmado se o `@cloudflare/vitest-pool-workers` 0.18 aceita a chave `send_email` ao ler o `wrangler.jsonc`. Se o `npm test` falhar ao carregar a config com erro referente a `send_email`, o contorno é remover `wrangler: { configPath }` e declarar `compatibilityDate: "2026-07-01"` dentro de `miniflare`. Os testes não precisam do binding real: eles injetam um `EMAIL` fake via `envWith()` (Task 8).

- [ ] **Step 9: Rodar a suíte e o typecheck**

```bash
cd api && npm test && npm run typecheck
```

Esperado: **verde**. Os testes remanescentes são `health`, `jwt`, `cookies` e `middleware`, e nenhum deles depende do que foi removido — `src/db/schema.ts` e `src/db/users.ts` não são tocados nesta tarefa, então a migração antiga continua coerente com o código.

Se algo falhar aqui, é defeito da tarefa e precisa ser corrigido antes do commit — não siga adiante com a suíte vermelha.

- [ ] **Step 10: Commit**

```bash
cd api && git add -A . && git commit -m "refactor(api): remove OAuth Hotmart e reconfigura ambiente

A Hotmart não oferece OAuth de identidade para login de terceiros. Sai o
cliente OAuth, o state cookie e as rotas de redirect/callback. Entram a
nova Env (hottok, HMAC, Turnstile, Email Sending, ucodes), o binding
send_email, o cron trigger e o split app.ts/index.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Schema novo e migração única

Cinco tabelas, com as ações de exclusão declaradas desde a primeira migração — é o que faz a exclusão de conta (sub-projeto 4) ser um único `DELETE FROM users`. A migração antiga é descartada e regenerada: o banco nunca foi aplicado em produção (`database_id` é placeholder).

**Files:**
- Modify: `src/db/schema.ts`
- Delete + regenerate: `migrations/`
- Create: `test/db.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: tabelas Drizzle `users`, `subscriptions`, `authTokens`, `webhookEvents`, `deletedAccounts` de `src/db/schema.ts`.

- [ ] **Step 1: Escrever o teste que falha**

`test/db.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import {
  users,
  subscriptions,
  authTokens,
  webhookEvents,
  deletedAccounts,
} from "../src/db/schema";

const db = () => getDb(env);

async function seedUser(id: string, email: string) {
  const now = new Date();
  await db()
    .insert(users)
    .values({ id, email, role: "user", createdAt: now, updatedAt: now })
    .run();
  return id;
}

describe("schema", () => {
  it("grava e lê um usuário com os campos novos", async () => {
    const now = new Date();
    await db()
      .insert(users)
      .values({
        id: "u-schema-1",
        email: "schema1@test.com",
        name: "Aluno Um",
        documentHash: "deadbeef",
        passwordHash: "pbkdf2$sha256$1$a$b",
        role: "user",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = await db()
      .select()
      .from(users)
      .where(eq(users.id, "u-schema-1"))
      .get();

    expect(row?.name).toBe("Aluno Um");
    expect(row?.documentHash).toBe("deadbeef");
    expect(row?.passwordHash).toBe("pbkdf2$sha256$1$a$b");
    expect(row?.createdAt instanceof Date).toBe(true);
  });

  it("subscriptions tem PK em hotmart_subscriber_code", async () => {
    await seedUser("u-schema-2", "schema2@test.com");
    const now = new Date();
    await db()
      .insert(subscriptions)
      .values({
        hotmartSubscriberCode: "SUB-A",
        userId: "u-schema-2",
        productUcode: "UCODE_ASSINATURA",
        status: "ACTIVE",
        accessUntil: new Date(Date.now() + 86400000),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.hotmartSubscriberCode, "SUB-A"))
      .get();

    expect(row?.userId).toBe("u-schema-2");
  });

  it("um usuário pode ter duas assinaturas (1:N)", async () => {
    await seedUser("u-schema-3", "schema3@test.com");
    const now = new Date();
    for (const code of ["SUB-B", "SUB-C"]) {
      await db()
        .insert(subscriptions)
        .values({
          hotmartSubscriberCode: code,
          userId: "u-schema-3",
          productUcode: "UCODE_ASSINATURA",
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const rows = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "u-schema-3"))
      .all();

    expect(rows).toHaveLength(2);
  });

  it("DELETE em users cascateia para subscriptions e auth_tokens", async () => {
    await seedUser("u-schema-4", "schema4@test.com");
    const now = new Date();
    await db()
      .insert(subscriptions)
      .values({
        hotmartSubscriberCode: "SUB-D",
        userId: "u-schema-4",
        productUcode: "UCODE_ASSINATURA",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await db()
      .insert(authTokens)
      .values({
        tokenHash: "hash-d",
        userId: "u-schema-4",
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: now,
      })
      .run();

    await db().delete(users).where(eq(users.id, "u-schema-4")).run();

    const subs = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "u-schema-4"))
      .all();
    const toks = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, "u-schema-4"))
      .all();

    expect(subs).toHaveLength(0);
    expect(toks).toHaveLength(0);
  });

  it("webhook_events e deleted_accounts existem e aceitam escrita", async () => {
    await db()
      .insert(webhookEvents)
      .values({
        id: "evt-1",
        event: "PURCHASE_APPROVED",
        status: "processed",
        receivedAt: new Date(),
      })
      .run();
    await db()
      .insert(deletedAccounts)
      .values({ emailHash: "hash-email-1", deletedAt: new Date() })
      .run();

    const evt = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-1"))
      .get();
    const tomb = await db()
      .select()
      .from(deletedAccounts)
      .where(eq(deletedAccounts.emailHash, "hash-email-1"))
      .get();

    expect(evt?.status).toBe("processed");
    expect(tomb?.deletedAt instanceof Date).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/db.test.ts
```

Esperado: FAIL — `authTokens`, `webhookEvents` e `deletedAccounts` não existem em `src/db/schema.ts`.

- [ ] **Step 3: Reescrever `src/db/schema.ts`**

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** HMAC-SHA256 do documento (só dígitos). Nunca o documento em claro. */
  documentHash: text("document_hash"),
  /** NULL = o aluno nunca definiu senha. */
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    hotmartSubscriberCode: text("hotmart_subscriber_code").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productUcode: text("product_ucode").notNull(),
    planName: text("plan_name"),
    /** Auditoria. NUNCA entra na decisão de acesso. */
    status: text("status").notNull(),
    /** Fonte da verdade do acesso: assinante enquanto access_until > now. */
    accessUntil: integer("access_until", { mode: "timestamp_ms" }),
    lastTransaction: text("last_transaction"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("subscriptions_user_id_idx").on(t.userId)],
);

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    /** SHA-256 do token opaco. O token em claro só existe no email. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("auth_tokens_user_id_idx").on(t.userId)],
);

export const webhookEvents = sqliteTable("webhook_events", {
  /** O `id` do evento Hotmart. Chave de idempotência. */
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  /** 'received' | 'processed' | 'ignored' */
  status: text("status").notNull(),
  note: text("note"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

export const deletedAccounts = sqliteTable("deleted_accounts", {
  /** HMAC-SHA256 do email normalizado. Nenhum dado legível. */
  emailHash: text("email_hash").primaryKey(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 4: Descartar a migração antiga e regenerar**

```bash
cd api && rm -rf migrations && npm run db:generate
```

- [ ] **Step 5: Conferir que a migração gerada tem as ações de exclusão**

```bash
cd api && grep -c "ON DELETE cascade" migrations/*.sql
```

Esperado: `2` (uma em `subscriptions`, uma em `auth_tokens`). Se sair `0`, o `references(..., { onDelete: "cascade" })` não foi aplicado — revisar o Step 3 antes de seguir.

- [ ] **Step 6: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: `test/db.test.ts` passa (5 testes). O teste de cascata é o que prova que o D1 aplica foreign keys por padrão.

- [ ] **Step 7: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): schema de auth própria com cascata de exclusão

Cinco tabelas: users (com name, document_hash, password_hash),
subscriptions 1:N com PK em hotmart_subscriber_code, auth_tokens,
webhook_events e deleted_accounts.

access_until é a fonte da verdade do acesso; status é só auditoria.
Toda FK para users declara ON DELETE CASCADE desde a primeira migração,
para que a exclusão de conta seja um único DELETE FROM users.

Migração antiga descartada e regenerada (banco nunca aplicado em prod).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Primitivas de cripto

Três módulos de funções puras, sem dependência de banco: comparação em tempo constante, HMAC com normalização, hash de senha e geração de token. Ficam juntos porque nenhum depende de nada e todos são pré-requisito das tarefas de domínio.

**Files:**
- Create: `src/lib/constantTime.ts`, `src/lib/hmac.ts`, `src/lib/password.ts`, `src/lib/tokens.ts`
- Test: `test/crypto.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `equalBytes(a: Uint8Array, b: Uint8Array): boolean`, `equalStrings(a: string, b: string): boolean` de `src/lib/constantTime.ts`
  - `normalizeEmail(raw: string): string`, `normalizeDocument(raw: string): string`, `hmacHex(value: string, key: string): Promise<string>` de `src/lib/hmac.ts`
  - `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>` de `src/lib/password.ts`
  - `generateToken(): string`, `hashToken(token: string): Promise<string>` de `src/lib/tokens.ts`

- [ ] **Step 1: Escrever o teste que falha**

`test/crypto.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { equalBytes, equalStrings } from "../src/lib/constantTime";
import { normalizeEmail, normalizeDocument, hmacHex } from "../src/lib/hmac";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { generateToken, hashToken } from "../src/lib/tokens";

describe("constantTime", () => {
  it("compara bytes iguais e diferentes", () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("compara strings", () => {
    expect(equalStrings("hottok-secreto", "hottok-secreto")).toBe(true);
    expect(equalStrings("hottok-secreto", "hottok-errado")).toBe(false);
    expect(equalStrings("", "")).toBe(true);
  });
});

describe("hmac", () => {
  it("normaliza email", () => {
    expect(normalizeEmail("  Aluno@Test.COM ")).toBe("aluno@test.com");
  });

  it("normaliza documento removendo tudo que não é dígito", () => {
    expect(normalizeDocument("123.456.789-09")).toBe("12345678909");
    expect(normalizeDocument("12345678909")).toBe("12345678909");
  });

  it("é determinístico e sensível à chave", async () => {
    const a = await hmacHex("12345678909", "chave-1");
    const b = await hmacHex("12345678909", "chave-1");
    const c = await hmacHex("12345678909", "chave-2");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("password", () => {
  it("gera hash no formato documentado", async () => {
    const stored = await hashPassword("senha-do-aluno");
    const parts = stored.split("$");

    expect(parts[0]).toBe("pbkdf2");
    expect(parts[1]).toBe("sha256");
    expect(parts[2]).toBe("100000");
    expect(parts).toHaveLength(5);
  });

  it("usa salt aleatório: dois hashes da mesma senha diferem", async () => {
    const a = await hashPassword("mesma-senha");
    const b = await hashPassword("mesma-senha");
    expect(a).not.toBe(b);
  });

  it("verifica a senha correta e rejeita a errada", async () => {
    const stored = await hashPassword("senha-certa");
    expect(await verifyPassword("senha-certa", stored)).toBe(true);
    expect(await verifyPassword("senha-errada", stored)).toBe(false);
  });

  it("rejeita hash malformado sem lançar", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$xyz")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$sha256$abc$a$b")).toBe(false);
  });
});

describe("tokens", () => {
  it("gera tokens únicos, url-safe e longos", () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("hashToken é determinístico e hex de 64 chars", async () => {
    const t = generateToken();
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t)).not.toBe(await hashToken(generateToken()));
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/crypto.test.ts
```

Esperado: FAIL — nenhum dos quatro módulos existe.

- [ ] **Step 3: Criar `src/lib/constantTime.ts`**

```typescript
/**
 * Comparação em tempo constante. O tamanho não é secreto (vaza pelo early
 * return), o que é o comportamento padrão de `crypto.timingSafeEqual`.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function equalStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return equalBytes(enc.encode(a), enc.encode(b));
}
```

- [ ] **Step 4: Criar `src/lib/hmac.ts`**

```typescript
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeDocument(raw: string): string {
  return raw.replace(/\D/g, "");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HMAC-SHA256 em hex. Usado para documento e para o email da tombstone.
 * A chave é um pepper em secret: sem ela, um dump do banco não permite
 * ataque de dicionário (um CPF tem só ~10^9 candidatos válidos).
 */
export async function hmacHex(value: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(value));
  return toHex(sig);
}
```

- [ ] **Step 5: Criar `src/lib/password.ts`**

```typescript
import { equalBytes } from "./constantTime";

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Formato: pbkdf2$sha256$<iterações>$<salt_b64>$<hash_b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  if (parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;

  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  try {
    const salt = fromBase64(parts[3]);
    const expected = fromBase64(parts[4]);
    const actual = await derive(password, salt, iterations);
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Criar `src/lib/tokens.ts`**

```typescript
const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Token opaco de 256 bits. Só existe em claro dentro do email. */
export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * SHA-256 puro basta aqui (ao contrário da senha): o token tem 256 bits de
 * entropia, não há dicionário possível.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 7: Rodar os testes**

```bash
cd api && npx vitest run test/crypto.test.ts && npm run typecheck
```

Esperado: PASS (12 testes).

- [ ] **Step 8: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): primitivas de cripto (constantTime, hmac, password, tokens)

PBKDF2-HMAC-SHA256 com 100k iterações via WebCrypto, sem dependência
externa (Workers não tem bcrypt/argon2 nativo). Parâmetros embutidos no
hash armazenado para elevar o custo depois sem migração.

HMAC com pepper em secret para documento e email: hash simples de CPF é
quebrável (~10^9 candidatos válidos).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `db/users.ts` — upsert, entitlement e senha

O ponto único onde o tier é derivado. `loadEntitlement` é a função que todo request protegido chama, e é ela que faz a revogação ser imediata.

**Files:**
- Modify: `src/db/users.ts`, `src/routes/auth.ts`, `test/middleware.test.ts`
- Test: `test/users.test.ts`

> **Atenção — dois arquivos existentes quebram nesta tarefa.** `test/middleware.test.ts` importa `upsertUser` e `ensureSubscription`, que deixam de existir ao reescrever `src/db/users.ts`; e `/auth/me` passa a poder devolver `name`. Os Steps 4 e 5 tratam ambos. Não basta rodar `npm test` no fim e torcer.

**Interfaces:**
- Consumes: tabelas `users`, `subscriptions` (Task 2); `Db` de `src/db/client.ts`.
- Produces, de `src/db/users.ts`:
  - `type Tier = "assinante" | "gratuito"`
  - `interface Entitlement { userId: string; email: string; name: string | null; role: "admin" | "user"; tier: Tier }`
  - `interface PurchaseIdentity { email: string; name: string | null; documentHash: string | null }`
  - `upsertUserFromPurchase(db: Db, identity: PurchaseIdentity, adminEmails: string[]): Promise<string>` — retorna o `userId`
  - `findUserByEmail(db: Db, email: string): Promise<UserRow | undefined>`
  - `findUserById(db: Db, id: string): Promise<UserRow | undefined>`
  - `setPasswordHash(db: Db, userId: string, passwordHash: string): Promise<void>`
  - `loadEntitlement(db: Db, userId: string): Promise<Entitlement | null>`
  - `type UserRow = typeof users.$inferSelect`

- [ ] **Step 1: Escrever o teste que falha**

`test/users.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { users, subscriptions } from "../src/db/schema";
import {
  upsertUserFromPurchase,
  findUserByEmail,
  setPasswordHash,
  loadEntitlement,
} from "../src/db/users";

const db = () => getDb(env);
const ADMINS = ["admin@test.com"];

async function addSubscription(
  userId: string,
  code: string,
  accessUntil: Date | null,
) {
  const now = new Date();
  await db()
    .insert(subscriptions)
    .values({
      hotmartSubscriberCode: code,
      userId,
      productUcode: "UCODE_ASSINATURA",
      status: "ACTIVE",
      accessUntil,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("upsertUserFromPurchase", () => {
  it("cria o usuário com role 'user'", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "novo@test.com", name: "Aluno Novo", documentHash: "hash-doc" },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "novo@test.com");
    expect(row?.id).toBe(id);
    expect(row?.role).toBe("user");
    expect(row?.name).toBe("Aluno Novo");
    expect(row?.documentHash).toBe("hash-doc");
    expect(row?.passwordHash).toBeNull();
  });

  it("concede role 'admin' pela allowlist", async () => {
    await upsertUserFromPurchase(
      db(),
      { email: "admin@test.com", name: null, documentHash: null },
      ADMINS,
    );
    const row = await findUserByEmail(db(), "admin@test.com");
    expect(row?.role).toBe("admin");
  });

  it("é idempotente: segunda compra reusa o mesmo usuário", async () => {
    const first = await upsertUserFromPurchase(
      db(),
      { email: "repetido@test.com", name: "Nome", documentHash: "d1" },
      ADMINS,
    );
    const second = await upsertUserFromPurchase(
      db(),
      { email: "repetido@test.com", name: "Nome", documentHash: "d1" },
      ADMINS,
    );
    expect(second).toBe(first);
  });

  it("não apaga name/documentHash quando o novo payload vem sem eles", async () => {
    await upsertUserFromPurchase(
      db(),
      { email: "preserva@test.com", name: "Tem Nome", documentHash: "tem-doc" },
      ADMINS,
    );
    await upsertUserFromPurchase(
      db(),
      { email: "preserva@test.com", name: null, documentHash: null },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "preserva@test.com");
    expect(row?.name).toBe("Tem Nome");
    expect(row?.documentHash).toBe("tem-doc");
  });

  it("nunca reseta a senha já definida", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "comsenha@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await setPasswordHash(db(), id, "pbkdf2$sha256$100000$s$h");
    await upsertUserFromPurchase(
      db(),
      { email: "comsenha@test.com", name: null, documentHash: null },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "comsenha@test.com");
    expect(row?.passwordHash).toBe("pbkdf2$sha256$100000$s$h");
  });
});

describe("loadEntitlement", () => {
  it("retorna null para usuário inexistente", async () => {
    expect(await loadEntitlement(db(), "nao-existe")).toBeNull();
  });

  it("tier 'gratuito' sem assinatura", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "sem-sub@test.com", name: null, documentHash: null },
      ADMINS,
    );
    const ent = await loadEntitlement(db(), id);
    expect(ent?.tier).toBe("gratuito");
    expect(ent?.role).toBe("user");
    expect(ent?.email).toBe("sem-sub@test.com");
  });

  it("tier 'assinante' com access_until no futuro", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "ativo@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-1", new Date(Date.now() + 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("assinante");
  });

  it("tier 'gratuito' com access_until no passado", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "expirado@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-2", new Date(Date.now() - 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("gratuito");
  });

  it("tier 'gratuito' com access_until nulo", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "nulo@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-3", null);
    expect((await loadEntitlement(db(), id))?.tier).toBe("gratuito");
  });

  it("duas assinaturas, uma válida → assinante", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "duas@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-4", new Date(Date.now() - 86400000));
    await addSubscription(id, "SUB-ENT-5", new Date(Date.now() + 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("assinante");
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/users.test.ts
```

Esperado: FAIL — `upsertUserFromPurchase` e `setPasswordHash` não existem.

- [ ] **Step 3: Reescrever `src/db/users.ts`**

```typescript
import { eq, and, gt } from "drizzle-orm";
import type { Db } from "./client";
import { users, subscriptions } from "./schema";

export type Tier = "assinante" | "gratuito";

export type UserRow = typeof users.$inferSelect;

export interface Entitlement {
  userId: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  tier: Tier;
}

/** Identidade extraída de um evento de compra. `email` já normalizado. */
export interface PurchaseIdentity {
  email: string;
  name: string | null;
  documentHash: string | null;
}

export function findUserByEmail(
  db: Db,
  email: string,
): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/**
 * Cria ou atualiza o usuário a partir de uma compra.
 *
 * Regras:
 * - `role` vem SÓ da allowlist. O webhook nunca concede admin.
 * - `name`/`documentHash` nulos no payload não sobrescrevem valores já gravados
 *   (a Hotmart só envia campos do comprador que o checkout solicitou).
 * - `passwordHash` nunca é tocado aqui.
 */
export async function upsertUserFromPurchase(
  db: Db,
  identity: PurchaseIdentity,
  adminEmails: string[],
): Promise<string> {
  const role = adminEmails.includes(identity.email) ? "admin" : "user";
  const now = new Date();
  const existing = await findUserByEmail(db, identity.email);

  if (existing) {
    await db
      .update(users)
      .set({
        role,
        name: identity.name ?? existing.name,
        documentHash: identity.documentHash ?? existing.documentHash,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id,
      email: identity.email,
      name: identity.name,
      documentHash: identity.documentHash,
      role,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export async function setPasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Ponto único de derivação do tier. Chamado a cada request protegido, o que
 * faz a revogação ser imediata: o JWT não carrega role nem tier.
 *
 * `access_until > now` é o ÚNICO predicado de acesso. `status` não participa.
 */
export async function loadEntitlement(
  db: Db,
  userId: string,
): Promise<Entitlement | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const active = await db
    .select({ code: subscriptions.hotmartSubscriberCode })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        gt(subscriptions.accessUntil, new Date()),
      ),
    )
    .get();

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as "admin" | "user",
    tier: active ? "assinante" : "gratuito",
  };
}
```

- [ ] **Step 4: Adaptar `test/middleware.test.ts` à nova API**

O helper `sessionCookieFor` usa `upsertUser` e `ensureSubscription`, que não existem mais. Substituir os imports e o helper:

```typescript
import { upsertUserFromPurchase } from "../src/db/users";
```

```typescript
async function sessionCookieFor(email: string): Promise<string> {
  const id = await upsertUserFromPurchase(
    getDb(env),
    { email, name: null, documentHash: null },
    ["admin@test.com"],
  );
  const token = await signSession(id, env.JWT_SECRET);
  return `session=${token}`;
}
```

Remover o import de `ensureSubscription`. Não há mais linha de `Subscription` placeholder: sem assinatura o tier é `gratuito`, que é o que esses testes esperam. Os quatro `it` continuam válidos sem alteração.

- [ ] **Step 5: Incluir `name` na resposta de `/auth/me`**

Em `src/routes/auth.ts`, o handler de `/me` (deixado sem `name` na Task 1) agora pode devolvê-lo:

```typescript
auth.get("/me", requireSession, (c) => {
  const ent = c.get("entitlement");
  return c.json({
    id: ent.userId,
    email: ent.email,
    name: ent.name,
    role: ent.role,
    tier: ent.tier,
  });
});
```

- [ ] **Step 6: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: `test/users.test.ts` passa (11 testes) e a suíte inteira fica verde, incluindo `test/middleware.test.ts` adaptado.

- [ ] **Step 7: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): users com upsert de compra e entitlement por access_until

loadEntitlement deriva o tier de uma única comparação de data e é relido
a cada request protegido, o que torna a revogação imediata.

upsertUserFromPurchase preserva name/documentHash quando o payload vem
sem eles e nunca toca passwordHash. Role vem só da allowlist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `db/subscriptions.ts`

**Files:**
- Create: `src/db/subscriptions.ts`
- Test: `test/subscriptions.test.ts`

**Interfaces:**
- Consumes: tabela `subscriptions` (Task 2); `upsertUserFromPurchase` (Task 4) nos testes.
- Produces, de `src/db/subscriptions.ts`:
  - `interface SubscriptionUpsert { subscriberCode: string; userId: string; productUcode: string; planName: string | null; status: string; accessUntil: Date | null; lastTransaction: string | null }`
  - `upsertSubscription(db: Db, input: SubscriptionUpsert): Promise<void>`
  - `findSubscriptionByCode(db: Db, code: string): Promise<SubscriptionRow | undefined>`
  - `listSubscriptionCodes(db: Db): Promise<string[]>`
  - `setAccessUntil(db: Db, code: string, accessUntil: Date): Promise<void>`
  - `setStatus(db: Db, code: string, status: string): Promise<void>`
  - `revokeAccess(db: Db, code: string, status: string): Promise<void>`
  - `type SubscriptionRow = typeof subscriptions.$inferSelect`

- [ ] **Step 1: Escrever o teste que falha**

`test/subscriptions.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase } from "../src/db/users";
import {
  upsertSubscription,
  findSubscriptionByCode,
  listSubscriptionCodes,
  setAccessUntil,
  revokeAccess,
} from "../src/db/subscriptions";

const db = () => getDb(env);

async function aUser(email: string): Promise<string> {
  return upsertUserFromPurchase(
    db(),
    { email, name: null, documentHash: null },
    [],
  );
}

describe("upsertSubscription", () => {
  it("cria a assinatura", async () => {
    const userId = await aUser("sub1@test.com");
    const until = new Date(Date.now() + 86400000);

    await upsertSubscription(db(), {
      subscriberCode: "SUB-1",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      accessUntil: until,
      lastTransaction: "HP123",
    });

    const row = await findSubscriptionByCode(db(), "SUB-1");
    expect(row?.userId).toBe(userId);
    expect(row?.planName).toBe("Mensal");
    expect(row?.status).toBe("ACTIVE");
    expect(row?.accessUntil?.getTime()).toBe(until.getTime());
    expect(row?.lastTransaction).toBe("HP123");
  });

  it("atualiza a assinatura existente sem duplicar (renovação)", async () => {
    const userId = await aUser("sub2@test.com");
    const first = new Date(Date.now() + 86400000);
    const renewed = new Date(Date.now() + 30 * 86400000);

    const base = {
      subscriberCode: "SUB-2",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      lastTransaction: "HP1",
    };
    await upsertSubscription(db(), { ...base, accessUntil: first });
    await upsertSubscription(db(), {
      ...base,
      accessUntil: renewed,
      lastTransaction: "HP2",
    });

    const row = await findSubscriptionByCode(db(), "SUB-2");
    expect(row?.accessUntil?.getTime()).toBe(renewed.getTime());
    expect(row?.lastTransaction).toBe("HP2");

    const codes = await listSubscriptionCodes(db());
    expect(codes.filter((c) => c === "SUB-2")).toHaveLength(1);
  });

  it("preserva created_at na atualização", async () => {
    const userId = await aUser("sub3@test.com");
    const base = {
      subscriberCode: "SUB-3",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    };
    await upsertSubscription(db(), base);
    const created = (await findSubscriptionByCode(db(), "SUB-3"))!.createdAt;

    await upsertSubscription(db(), { ...base, status: "DELAYED" });
    const after = await findSubscriptionByCode(db(), "SUB-3");

    expect(after!.createdAt.getTime()).toBe(created.getTime());
    expect(after!.status).toBe("DELAYED");
  });
});

describe("mutações de acesso", () => {
  it("setAccessUntil corrige só a data", async () => {
    const userId = await aUser("sub4@test.com");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-4",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    });

    const corrected = new Date(Date.now() + 10 * 86400000);
    await setAccessUntil(db(), "SUB-4", corrected);

    const row = await findSubscriptionByCode(db(), "SUB-4");
    expect(row?.accessUntil?.getTime()).toBe(corrected.getTime());
    expect(row?.status).toBe("ACTIVE");
  });

  it("revokeAccess põe access_until no passado e grava o status", async () => {
    const userId = await aUser("sub5@test.com");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-5",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 30 * 86400000),
      lastTransaction: null,
    });

    await revokeAccess(db(), "SUB-5", "REFUNDED");

    const row = await findSubscriptionByCode(db(), "SUB-5");
    expect(row?.status).toBe("REFUNDED");
    expect(row!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("findSubscriptionByCode devolve undefined para código desconhecido", async () => {
    expect(await findSubscriptionByCode(db(), "NAO-EXISTE")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/subscriptions.test.ts
```

Esperado: FAIL — `src/db/subscriptions.ts` não existe.

- [ ] **Step 3: Criar `src/db/subscriptions.ts`**

```typescript
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { subscriptions } from "./schema";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export interface SubscriptionUpsert {
  subscriberCode: string;
  userId: string;
  productUcode: string;
  planName: string | null;
  status: string;
  accessUntil: Date | null;
  lastTransaction: string | null;
}

export function findSubscriptionByCode(
  db: Db,
  code: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .get();
}

export async function listSubscriptionCodes(db: Db): Promise<string[]> {
  const rows = await db
    .select({ code: subscriptions.hotmartSubscriberCode })
    .from(subscriptions)
    .all();
  return rows.map((r) => r.code);
}

/** Upsert pela PK `hotmart_subscriber_code`. Preserva `created_at`. */
export async function upsertSubscription(
  db: Db,
  input: SubscriptionUpsert,
): Promise<void> {
  const now = new Date();
  await db
    .insert(subscriptions)
    .values({
      hotmartSubscriberCode: input.subscriberCode,
      userId: input.userId,
      productUcode: input.productUcode,
      planName: input.planName,
      status: input.status,
      accessUntil: input.accessUntil,
      lastTransaction: input.lastTransaction,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.hotmartSubscriberCode,
      set: {
        userId: input.userId,
        productUcode: input.productUcode,
        planName: input.planName,
        status: input.status,
        accessUntil: input.accessUntil,
        lastTransaction: input.lastTransaction,
        updatedAt: now,
      },
    })
    .run();
}

export async function setAccessUntil(
  db: Db,
  code: string,
  accessUntil: Date,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ accessUntil, updatedAt: new Date() })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}

export async function setStatus(
  db: Db,
  code: string,
  status: string,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status, updatedAt: new Date() })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}

/** Revogação = escrever `access_until` no passado. É o único mecanismo. */
export async function revokeAccess(
  db: Db,
  code: string,
  status: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(subscriptions)
    .set({ status, accessUntil: now, updatedAt: now })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npx vitest run test/subscriptions.test.ts && npm run typecheck
```

Esperado: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): db/subscriptions com upsert por subscriber_code

Upsert pela PK preserva created_at. revokeAccess escreve access_until no
passado — a revogação é sempre uma escrita de data, nunca uma leitura de
status.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `db/authTokens.ts` — link mágico, cooldown e invalidação

**Files:**
- Create: `src/db/authTokens.ts`
- Test: `test/authTokens.test.ts`

**Interfaces:**
- Consumes: tabela `authTokens` (Task 2); `generateToken`, `hashToken` (Task 3).
- Produces, de `src/db/authTokens.ts`:
  - `const FIRST_ACCESS_TTL_MS = 172_800_000`
  - `const RECOVERY_TTL_MS = 3_600_000`
  - `const RECOVERY_COOLDOWN_MS = 300_000`
  - `createToken(db: Db, userId: string, ttlMs: number): Promise<string>` — retorna o token **em claro**
  - `consumeToken(db: Db, token: string): Promise<string | null>` — retorna o `userId` e invalida todos os tokens do usuário
  - `hasPendingToken(db: Db, userId: string): Promise<boolean>`
  - `issuedWithin(db: Db, userId: string, windowMs: number): Promise<boolean>`

- [ ] **Step 1: Escrever o teste que falha**

`test/authTokens.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase } from "../src/db/users";
import { hashToken } from "../src/lib/tokens";
import {
  createToken,
  consumeToken,
  hasPendingToken,
  issuedWithin,
  FIRST_ACCESS_TTL_MS,
  RECOVERY_TTL_MS,
  RECOVERY_COOLDOWN_MS,
} from "../src/db/authTokens";

const db = () => getDb(env);

async function aUser(email: string): Promise<string> {
  return upsertUserFromPurchase(
    db(),
    { email, name: null, documentHash: null },
    [],
  );
}

describe("createToken", () => {
  it("grava só o hash, nunca o token em claro", async () => {
    const userId = await aUser("tok1@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    const byHash = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .get();
    const byPlain = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, token))
      .get();

    expect(byHash?.userId).toBe(userId);
    expect(byPlain).toBeUndefined();
  });

  it("respeita o TTL recebido", async () => {
    const userId = await aUser("tok2@test.com");
    const token = await createToken(db(), userId, RECOVERY_TTL_MS);

    const row = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .get();

    const delta = row!.expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(RECOVERY_TTL_MS - 10_000);
    expect(delta).toBeLessThanOrEqual(RECOVERY_TTL_MS);
  });
});

describe("consumeToken", () => {
  it("aceita o token válido e devolve o userId", async () => {
    const userId = await aUser("tok3@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    expect(await consumeToken(db(), token)).toBe(userId);
  });

  it("rejeita token inexistente", async () => {
    expect(await consumeToken(db(), "token-que-nao-existe")).toBeNull();
  });

  it("rejeita token já usado", async () => {
    const userId = await aUser("tok4@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), token)).toBe(userId);
    expect(await consumeToken(db(), token)).toBeNull();
  });

  it("rejeita token expirado", async () => {
    const userId = await aUser("tok5@test.com");
    const token = await createToken(db(), userId, 1000);

    // envelhece o token diretamente no banco
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await consumeToken(db(), token)).toBeNull();
  });

  it("ao usar um token, invalida os demais do mesmo usuário", async () => {
    const userId = await aUser("tok6@test.com");
    const first = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    const second = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), second)).toBe(userId);
    expect(await consumeToken(db(), first)).toBeNull();
  });

  it("não afeta tokens de outro usuário", async () => {
    const a = await aUser("tok7a@test.com");
    const b = await aUser("tok7b@test.com");
    const tokenA = await createToken(db(), a, FIRST_ACCESS_TTL_MS);
    const tokenB = await createToken(db(), b, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), tokenA)).toBe(a);
    expect(await consumeToken(db(), tokenB)).toBe(b);
  });
});

describe("hasPendingToken", () => {
  it("false sem token, true com token válido", async () => {
    const userId = await aUser("tok8@test.com");
    expect(await hasPendingToken(db(), userId)).toBe(false);

    await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    expect(await hasPendingToken(db(), userId)).toBe(true);
  });

  it("false depois de o token ser consumido", async () => {
    const userId = await aUser("tok9@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    await consumeToken(db(), token);
    expect(await hasPendingToken(db(), userId)).toBe(false);
  });

  it("false para token expirado", async () => {
    const userId = await aUser("tok10@test.com");
    const token = await createToken(db(), userId, 1000);
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await hasPendingToken(db(), userId)).toBe(false);
  });
});

describe("issuedWithin (cooldown)", () => {
  it("true logo após emitir, false se o token for antigo", async () => {
    const userId = await aUser("tok11@test.com");
    const token = await createToken(db(), userId, RECOVERY_TTL_MS);
    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(true);

    await db()
      .update(authTokens)
      .set({ createdAt: new Date(Date.now() - RECOVERY_COOLDOWN_MS - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(false);
  });

  it("false para usuário sem nenhum token", async () => {
    const userId = await aUser("tok12@test.com");
    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/authTokens.test.ts
```

Esperado: FAIL — `src/db/authTokens.ts` não existe.

- [ ] **Step 3: Criar `src/db/authTokens.ts`**

```typescript
import { eq, and, gt, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { authTokens } from "./schema";
import { generateToken, hashToken } from "../lib/tokens";

/** Email de compra pode ficar dias sem ser aberto. */
export const FIRST_ACCESS_TTL_MS = 172_800_000; // 48h
/** Recuperação é uma ação deliberada e imediata. */
export const RECOVERY_TTL_MS = 3_600_000; // 1h
/** Anti email-bombing de uma vítima cujo email+CPF o atacante conheça. */
export const RECOVERY_COOLDOWN_MS = 300_000; // 5min

/** Cria o token e devolve o valor EM CLARO — só o email o verá. */
export async function createToken(
  db: Db,
  userId: string,
  ttlMs: number,
): Promise<string> {
  const token = generateToken();
  const now = new Date();
  await db
    .insert(authTokens)
    .values({
      tokenHash: await hashToken(token),
      userId,
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    })
    .run();
  return token;
}

/**
 * Consome o token: valida, e ao aceitar marca TODOS os tokens do usuário como
 * usados. Um link novo invalida os anteriores.
 *
 * A validação e a queima do token são UMA operação só — um UPDATE condicional
 * com RETURNING. Um par SELECT-depois-UPDATE abriria janela para duas chamadas
 * concorrentes passarem pela checagem antes de qualquer escrita cair, e ambas
 * consumirem o mesmo token. Como este é o único credencial de acesso do
 * sistema (não há autocadastro), o uso único precisa ser atômico de verdade.
 */
export async function consumeToken(
  db: Db,
  token: string,
): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, await hashToken(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });

  if (!row) return null;

  // Invalida os DEMAIS tokens do usuário. Passo idempotente, não decide nada,
  // e por isso não precisa ser atômico.
  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.userId, row.userId), isNull(authTokens.usedAt)))
    .run();

  return row.userId;
}

/** Guarda contra enviar um segundo link quando já existe um válido. */
export async function hasPendingToken(
  db: Db,
  userId: string,
): Promise<boolean> {
  const row = await db
    .select({ hash: authTokens.tokenHash })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .get();
  return row !== undefined;
}

export async function issuedWithin(
  db: Db,
  userId: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const row = await db
    .select({ hash: authTokens.tokenHash })
    .from(authTokens)
    .where(
      and(eq(authTokens.userId, userId), gt(authTokens.createdAt, since)),
    )
    .get();
  return row !== undefined;
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npx vitest run test/authTokens.test.ts && npm run typecheck
```

Esperado: PASS (12 testes).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): auth_tokens com uso único, TTLs distintos e cooldown

Só o SHA-256 do token vai ao banco. Consumir um token invalida todos os
do usuário. TTL 48h no primeiro acesso (email de compra pode demorar a
ser lido) e 1h na recuperação. Cooldown de 5min contra email-bombing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Tabelas de controle — `webhookEvents` e `deletedAccounts`

Duas tabelas pequenas e sem relação entre si, mas ambas são guardas do webhook e do cron. O `claimEvent` é o que impede reprocessamento — e o que garante que uma falha no meio do caminho seja retentável.

**Files:**
- Create: `src/db/webhookEvents.ts`, `src/db/deletedAccounts.ts`
- Test: `test/controlTables.test.ts`

**Interfaces:**
- Consumes: tabelas `webhookEvents`, `deletedAccounts` (Task 2).
- Produces:
  - de `src/db/webhookEvents.ts`: `type ClaimResult = "claimed" | "already_done"`, `claimEvent(db: Db, id: string, event: string): Promise<ClaimResult>`, `markProcessed(db: Db, id: string): Promise<void>`, `markIgnored(db: Db, id: string, note: string): Promise<void>`
  - de `src/db/deletedAccounts.ts`: `isDeleted(db: Db, emailHash: string): Promise<boolean>`, `markDeleted(db: Db, emailHash: string): Promise<void>`, `clearTombstone(db: Db, emailHash: string): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

`test/controlTables.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import {
  claimEvent,
  markProcessed,
  markIgnored,
} from "../src/db/webhookEvents";
import {
  isDeleted,
  markDeleted,
  clearTombstone,
} from "../src/db/deletedAccounts";

const db = () => getDb(env);

describe("claimEvent", () => {
  it("primeiro claim registra como 'received'", async () => {
    expect(await claimEvent(db(), "ev-1", "PURCHASE_APPROVED")).toBe("claimed");

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "ev-1"))
      .get();
    expect(row?.status).toBe("received");
    expect(row?.event).toBe("PURCHASE_APPROVED");
  });

  it("reenvio de evento já processado devolve 'already_done'", async () => {
    await claimEvent(db(), "ev-2", "PURCHASE_APPROVED");
    await markProcessed(db(), "ev-2");
    expect(await claimEvent(db(), "ev-2", "PURCHASE_APPROVED")).toBe(
      "already_done",
    );
  });

  it("reenvio de evento ignorado devolve 'already_done'", async () => {
    await claimEvent(db(), "ev-3", "PURCHASE_COMPLETE");
    await markIgnored(db(), "ev-3", "ucode fora da lista");
    expect(await claimEvent(db(), "ev-3", "PURCHASE_COMPLETE")).toBe(
      "already_done",
    );
  });

  it("evento parado em 'received' é reprocessável", async () => {
    // simula tentativa anterior que morreu antes de marcar processed
    expect(await claimEvent(db(), "ev-4", "PURCHASE_APPROVED")).toBe("claimed");
    expect(await claimEvent(db(), "ev-4", "PURCHASE_APPROVED")).toBe("claimed");
  });

  it("markIgnored grava a nota", async () => {
    await claimEvent(db(), "ev-5", "PURCHASE_APPROVED");
    await markIgnored(db(), "ev-5", "assinante desconhecido");

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "ev-5"))
      .get();
    expect(row?.status).toBe("ignored");
    expect(row?.note).toBe("assinante desconhecido");
  });
});

describe("tombstone", () => {
  it("false para email nunca excluído", async () => {
    expect(await isDeleted(db(), "hash-inexistente")).toBe(false);
  });

  it("markDeleted e depois isDeleted", async () => {
    await markDeleted(db(), "hash-excluido");
    expect(await isDeleted(db(), "hash-excluido")).toBe(true);
  });

  it("markDeleted é idempotente", async () => {
    await markDeleted(db(), "hash-duas-vezes");
    await markDeleted(db(), "hash-duas-vezes");
    expect(await isDeleted(db(), "hash-duas-vezes")).toBe(true);
  });

  it("clearTombstone permite nova compra do mesmo email", async () => {
    await markDeleted(db(), "hash-volta");
    await clearTombstone(db(), "hash-volta");
    expect(await isDeleted(db(), "hash-volta")).toBe(false);
  });

  it("clearTombstone em hash inexistente não lança", async () => {
    await clearTombstone(db(), "hash-nunca-existiu");
    expect(await isDeleted(db(), "hash-nunca-existiu")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/controlTables.test.ts
```

Esperado: FAIL — os dois módulos não existem.

- [ ] **Step 3: Criar `src/db/webhookEvents.ts`**

```typescript
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { webhookEvents } from "./schema";

export type ClaimResult = "claimed" | "already_done";

/**
 * Idempotência do webhook.
 *
 * Só `processed` e `ignored` deduplicam. Uma linha parada em `received`
 * significa que a tentativa anterior morreu no meio (ex.: falha no envio do
 * email) — nesse caso o evento DEVE ser reprocessado, senão a Hotmart
 * retentaria em vão e o aluno pagante ficaria sem acesso.
 */
export async function claimEvent(
  db: Db,
  id: string,
  event: string,
): Promise<ClaimResult> {
  const existing = await db
    .select({ status: webhookEvents.status })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .get();

  if (existing) {
    return existing.status === "received" ? "claimed" : "already_done";
  }

  await db
    .insert(webhookEvents)
    .values({ id, event, status: "received", receivedAt: new Date() })
    .onConflictDoNothing()
    .run();

  return "claimed";
}

export async function markProcessed(db: Db, id: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "processed" })
    .where(eq(webhookEvents.id, id))
    .run();
}

export async function markIgnored(
  db: Db,
  id: string,
  note: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "ignored", note })
    .where(eq(webhookEvents.id, id))
    .run();
}
```

- [ ] **Step 4: Criar `src/db/deletedAccounts.ts`**

```typescript
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { deletedAccounts } from "./schema";

/**
 * Tombstone de exclusão de conta.
 *
 * Sem ela, o cron veria a assinatura ainda listada na API (assinatura
 * cancelada tem date_next_charge no futuro), a acharia ausente no D1, e
 * recriaria a conta com email de boas-vindas — desfazendo a exclusão na
 * madrugada seguinte ao pedido do titular.
 *
 * Guarda apenas o HMAC do email: nenhum dado legível.
 */
export async function isDeleted(db: Db, emailHash: string): Promise<boolean> {
  const row = await db
    .select({ hash: deletedAccounts.emailHash })
    .from(deletedAccounts)
    .where(eq(deletedAccounts.emailHash, emailHash))
    .get();
  return row !== undefined;
}

export async function markDeleted(db: Db, emailHash: string): Promise<void> {
  await db
    .insert(deletedAccounts)
    .values({ emailHash, deletedAt: new Date() })
    .onConflictDoNothing()
    .run();
}

/** Chamado numa compra nova (recurrence_number == 1): a tombstone não é banimento. */
export async function clearTombstone(
  db: Db,
  emailHash: string,
): Promise<void> {
  await db
    .delete(deletedAccounts)
    .where(eq(deletedAccounts.emailHash, emailHash))
    .run();
}
```

- [ ] **Step 5: Rodar os testes**

```bash
cd api && npx vitest run test/controlTables.test.ts && npm run typecheck
```

Esperado: PASS (10 testes).

- [ ] **Step 6: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): tabelas de controle (webhook_events, deleted_accounts)

claimEvent deduplica só 'processed'/'ignored'; linha em 'received' é
reprocessável, para que uma falha no envio do email seja retentável pela
Hotmart em vez de virar aluno pagante sem acesso.

Tombstone guarda só HMAC do email e impede o cron de recriar conta
excluída — assinatura cancelada continua listada na API com
date_next_charge no futuro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Adaptadores externos — email e Turnstile, e os helpers de teste

Dois wrappers finos sobre serviços externos, mais a infraestrutura de teste que todas as tarefas seguintes usam. O `EMAIL` é injetado pelo objeto `env` (o Miniflare não precisa fornecer o binding); o Turnstile é HTTP e usa stub de `fetch`, seguindo o padrão que já existia no repositório.

**Files:**
- Create: `src/lib/email.ts`, `src/lib/turnstile.ts`, `test/helpers.ts`
- Test: `test/email.test.ts`, `test/turnstile.test.ts`

**Interfaces:**
- Consumes: `Env`, `EmailMessage`, `EmailSender` (Task 1).
- Produces:
  - de `src/lib/email.ts`: `type MagicLinkKind = "first_access" | "recovery"`, `sendMagicLink(env: Env, params: { to: string; name: string | null; token: string; kind: MagicLinkKind }): Promise<void>`
  - de `src/lib/turnstile.ts`: `verifyTurnstile(env: Env, token: string, remoteIp?: string): Promise<boolean>`
  - de `test/helpers.ts`: `fakeEmailSender(): { sent: EmailMessage[]; sender: EmailSender }`, `envWith<T>(overrides: T): Cloudflare.Env & T`, `cookieFrom(res: Response, name: string): string | null`, `stubTurnstile(success: boolean): void`

- [ ] **Step 1: Criar `test/helpers.ts`**

Não tem teste próprio — é infraestrutura, exercitada por todos os testes seguintes.

```typescript
import { env } from "cloudflare:test";
import { vi } from "vitest";
import type { EmailMessage, EmailSender } from "../src/config/env";

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Coleta as mensagens em memória no lugar do binding send_email. */
export function fakeEmailSender(): { sent: EmailMessage[]; sender: EmailSender } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sender: {
      async send(message: EmailMessage) {
        sent.push(message);
        return { ok: true };
      },
    },
  };
}

/** Env de teste com overrides — é assim que o EMAIL fake entra. */
export function envWith<T extends Record<string, unknown>>(
  overrides: T,
): Cloudflare.Env & T {
  return { ...env, ...overrides } as Cloudflare.Env & T;
}

/**
 * Lê um Set-Cookie específico. `headers.get("set-cookie")` junta múltiplos
 * valores com ", ", ambíguo com as vírgulas dentro dos atributos do cookie;
 * getSetCookie() devolve cada valor intacto. Existe em runtime (Workers/undici)
 * mas não no tipo Headers do @cloudflare/workers-types, daí o cast.
 */
export function cookieFrom(res: Response, name: string): string | null {
  const all = (
    res.headers as unknown as { getSetCookie(): string[] }
  ).getSetCookie();
  const match = all.find((c) => c.startsWith(name + "="));
  return match ? match.split(";")[0].trim() : null;
}

/** Stub do siteverify. Chame `vi.unstubAllGlobals()` no afterEach. */
export function stubTurnstile(success: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === TURNSTILE_URL) {
        return new Response(JSON.stringify({ success }), { status: 200 });
      }
      throw new Error("fetch inesperado: " + String(input));
    }),
  );
}
```

- [ ] **Step 2: Escrever os testes que falham**

`test/email.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sendMagicLink } from "../src/lib/email";
import { fakeEmailSender, envWith } from "./helpers";

describe("sendMagicLink", () => {
  it("monta o link com APP_BASE_URL e o token", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "aluno@test.com",
      name: "Aluno",
      token: "TOKEN-ABC",
      kind: "first_access",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(
      "https://app.test/definir-senha?token=TOKEN-ABC",
    );
    expect(sent[0].text).toContain(
      "https://app.test/definir-senha?token=TOKEN-ABC",
    );
  });

  it("usa EMAIL_FROM e o destinatário informado", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "aluno@test.com",
      name: null,
      token: "T",
      kind: "first_access",
    });

    expect(sent[0].to).toBe("aluno@test.com");
    expect(sent[0].from).toBe("nao-responda@app.test");
  });

  it("assunto difere entre primeiro acesso e recuperação", async () => {
    const { sent, sender } = fakeEmailSender();
    const e = envWith({ EMAIL: sender });

    await sendMagicLink(e, {
      to: "a@test.com",
      name: null,
      token: "T1",
      kind: "first_access",
    });
    await sendMagicLink(e, {
      to: "a@test.com",
      name: null,
      token: "T2",
      kind: "recovery",
    });

    expect(sent[0].subject).not.toBe(sent[1].subject);
    expect(sent[0].subject.toLowerCase()).toContain("acesso");
    expect(sent[1].subject.toLowerCase()).toContain("recupera");
  });

  it("saúda pelo nome quando existe e usa fallback quando não", async () => {
    const { sent, sender } = fakeEmailSender();
    const e = envWith({ EMAIL: sender });

    await sendMagicLink(e, {
      to: "a@test.com",
      name: "Maria",
      token: "T",
      kind: "first_access",
    });
    await sendMagicLink(e, {
      to: "b@test.com",
      name: null,
      token: "T",
      kind: "first_access",
    });

    expect(sent[0].text).toContain("Maria");
    expect(sent[1].text).toContain("Olá");
  });

  it("codifica tokens com caracteres especiais na URL", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "a@test.com",
      name: null,
      token: "a+b/c=d",
      kind: "first_access",
    });

    expect(sent[0].html).toContain("token=a%2Bb%2Fc%3Dd");
  });
});
```

`test/turnstile.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyTurnstile } from "../src/lib/turnstile";
import { stubTurnstile } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("true quando o siteverify aprova", async () => {
    stubTurnstile(true);
    expect(await verifyTurnstile(env, "token-valido")).toBe(true);
  });

  it("false quando o siteverify reprova", async () => {
    stubTurnstile(false);
    expect(await verifyTurnstile(env, "token-invalido")).toBe(false);
  });

  it("false para token vazio, sem chamar a rede", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await verifyTurnstile(env, "")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("false quando o siteverify responde erro HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro", { status: 500 })),
    );
    expect(await verifyTurnstile(env, "qualquer")).toBe(false);
  });

  it("false quando a rede falha (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede caiu");
      }),
    );
    expect(await verifyTurnstile(env, "qualquer")).toBe(false);
  });

  it("envia o secret e o remoteip", async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ success: true })),
    );
    vi.stubGlobal("fetch", spy);

    await verifyTurnstile(env, "tok", "203.0.113.9");

    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.secret).toBe("test-turnstile-secret");
    expect(body.response).toBe("tok");
    expect(body.remoteip).toBe("203.0.113.9");
  });
});
```

- [ ] **Step 3: Rodar para confirmar que falham**

```bash
cd api && npx vitest run test/email.test.ts test/turnstile.test.ts
```

Esperado: FAIL — `src/lib/email.ts` e `src/lib/turnstile.ts` não existem.

- [ ] **Step 4: Criar `src/lib/email.ts`**

```typescript
import type { Env } from "../config/env";

export type MagicLinkKind = "first_access" | "recovery";

interface MagicLinkParams {
  to: string;
  name: string | null;
  token: string;
  kind: MagicLinkKind;
}

const COPY: Record<MagicLinkKind, { subject: string; intro: string }> = {
  first_access: {
    subject: "Seu acesso ao Mais Aprovação",
    intro:
      "Sua assinatura foi confirmada. Use o link abaixo para definir sua senha e começar a estudar.",
  },
  recovery: {
    subject: "Recuperação de acesso — Mais Aprovação",
    intro:
      "Recebemos um pedido de recuperação de acesso. Use o link abaixo para definir uma nova senha.",
  },
};

const EXPIRY_NOTE: Record<MagicLinkKind, string> = {
  first_access: "Este link vale por 48 horas e só pode ser usado uma vez.",
  recovery: "Este link vale por 1 hora e só pode ser usado uma vez.",
};

export async function sendMagicLink(
  env: Env,
  params: MagicLinkParams,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/definir-senha?token=${encodeURIComponent(params.token)}`;
  const greeting = params.name ? `Olá, ${params.name}!` : "Olá!";
  const copy = COPY[params.kind];
  const expiry = EXPIRY_NOTE[params.kind];

  const text = [
    greeting,
    "",
    copy.intro,
    "",
    url,
    "",
    expiry,
    "Se não foi você, ignore este email.",
  ].join("\n");

  const html = [
    `<p>${greeting}</p>`,
    `<p>${copy.intro}</p>`,
    `<p><a href="${url}">Definir minha senha</a></p>`,
    `<p>Se o botão não funcionar, copie e cole este endereço no navegador:<br>${url}</p>`,
    `<p><small>${expiry} Se não foi você, ignore este email.</small></p>`,
  ].join("\n");

  await env.EMAIL.send({
    to: params.to,
    from: env.EMAIL_FROM,
    subject: copy.subject,
    html,
    text,
  });
}
```

- [ ] **Step 5: Criar `src/lib/turnstile.ts`**

```typescript
import type { Env } from "../config/env";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Metade server-side do Turnstile. O widget é frontend (sub-projeto 4), mas a
 * verificação mora aqui — é ela que protege login e recuperação de força bruta.
 *
 * Fail-closed: qualquer falha (rede, HTTP, JSON) responde false.
 */
export async function verifyTurnstile(
  env: Env,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Rodar os testes**

```bash
cd api && npx vitest run test/email.test.ts test/turnstile.test.ts && npm run typecheck
```

Esperado: PASS (11 testes).

- [ ] **Step 7: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): adaptadores de email e Turnstile + helpers de teste

sendMagicLink monta o link para APP_BASE_URL e envia pelo binding EMAIL.
verifyTurnstile é fail-closed: rede, HTTP ou JSON ruim reprovam.

test/helpers.ts injeta o EMAIL fake pelo objeto env — o Miniflare não
precisa suportar o binding send_email.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Webhook — hottok, schema Zod e idempotência

A casca do webhook, sem efeito de domínio ainda: valida o token, faz o parse tolerante, e resolve idempotência. Os eventos são despachados nas tarefas 10 e 11.

**Files:**
- Create: `src/webhooks/hotmart.ts`, `test/fixtures/hotmart.ts`
- Modify: `src/app.ts`
- Test: `test/webhook-base.test.ts`

**Interfaces:**
- Consumes: `claimEvent`, `markProcessed`, `markIgnored` (Task 7); `equalStrings` (Task 3); `getSubscriptionUcodes` (Task 1).
- Produces:
  - de `src/webhooks/hotmart.ts`: `const webhooks: Hono<...>`, `type HotmartEvent = z.infer<typeof hotmartEventSchema>`, `hotmartEventSchema`
  - de `test/fixtures/hotmart.ts`: `purchaseApproved(overrides?): unknown`, `subscriptionCancellation(overrides?): unknown`, `postWebhook(app, payload, env, hottok?): Promise<Response>`

- [ ] **Step 1: Criar `test/fixtures/hotmart.ts`**

```typescript
/**
 * Fixtures derivados da documentação oficial (webhook 2.0.0), NÃO de tráfego
 * real. O runbook (Task 17) inclui capturar um evento do sandbox e conferir
 * estes formatos.
 */

interface PurchaseOverrides {
  id?: string;
  event?: string;
  ucode?: string;
  email?: string;
  name?: string | null;
  document?: string | null;
  subscriberCode?: string | null;
  dateNextCharge?: number | null;
  recurrenceNumber?: number;
  transaction?: string;
  planName?: string;
}

export function purchaseApproved(overrides: PurchaseOverrides = {}) {
  const {
    id = "evt-" + crypto.randomUUID(),
    event = "PURCHASE_APPROVED",
    ucode = "UCODE_ASSINATURA",
    email = "comprador@test.com",
    name = "Comprador Teste",
    document = "123.456.789-09",
    subscriberCode = "SUBCODE-1",
    dateNextCharge = Date.now() + 30 * 86400000,
    recurrenceNumber = 1,
    transaction = "HP17715690036014",
    planName = "Mensal",
  } = overrides;

  return {
    id,
    creation_date: Date.now(),
    event,
    version: "2.0.0",
    data: {
      product: { id: 1234567, ucode, name: "Mais Aprovação" },
      buyer: {
        email,
        ...(name === null ? {} : { name }),
        ...(document === null ? {} : { document, document_type: "CPF" }),
        checkout_phone: "5531999999999",
        address: { country: "Brasil", country_iso: "BR" },
      },
      purchase: {
        transaction,
        status: "APPROVED",
        approved_date: Date.now(),
        order_date: Date.now(),
        ...(dateNextCharge === null ? {} : { date_next_charge: dateNextCharge }),
        recurrence_number: recurrenceNumber,
        payment: { type: "PIX" },
        price: { value: 49.9, currency_value: "BRL" },
        offer: { code: "OFERTA1" },
      },
      ...(subscriberCode === null
        ? {}
        : {
            subscription: {
              status: "ACTIVE",
              plan: { id: 99, name: planName },
              subscriber: { code: subscriberCode },
            },
          }),
    },
  };
}

interface CancellationOverrides {
  id?: string;
  subscriberCode?: string;
  email?: string;
  dateNextCharge?: number | null;
}

export function subscriptionCancellation(
  overrides: CancellationOverrides = {},
) {
  const {
    id = "evt-" + crypto.randomUUID(),
    subscriberCode = "SUBCODE-1",
    email = "comprador@test.com",
    dateNextCharge = Date.now() + 15 * 86400000,
  } = overrides;

  return {
    id,
    creation_date: Date.now(),
    event: "SUBSCRIPTION_CANCELLATION",
    version: "2.0.0",
    data: {
      // ATENÇÃO: o payload de cancelamento NÃO traz product.ucode.
      product: { id: 1234567, name: "Mais Aprovação" },
      subscriber: { code: subscriberCode, name: "Comprador Teste", email },
      subscription: { id: 555, plan: { id: 99, name: "Mensal" } },
      cancellation_date: Date.now(),
      ...(dateNextCharge === null ? {} : { date_next_charge: dateNextCharge }),
    },
  };
}

export function postWebhook(
  app: { request: (path: string, init: RequestInit, env: unknown) => Promise<Response> },
  payload: unknown,
  env: unknown,
  hottok: string | null = "test-hottok",
): Promise<Response> {
  return app.request(
    "/webhooks/hotmart",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(hottok === null ? {} : { "x-hotmart-hottok": hottok }),
      },
      body: JSON.stringify(payload),
    },
    env,
  );
}
```

- [ ] **Step 2: Escrever o teste que falha**

`test/webhook-base.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import { fakeEmailSender, envWith } from "./helpers";
import { purchaseApproved, postWebhook } from "./fixtures/hotmart";

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

describe("webhook — validação e idempotência", () => {
  it("401 sem header de hottok", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, purchaseApproved(), e, null);
    expect(res.status).toBe(401);
  });

  it("401 com hottok errado", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, purchaseApproved(), e, "hottok-errado");
    expect(res.status).toBe(401);
  });

  it("não registra o evento quando o hottok é inválido", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({ id: "evt-hottok-ruim" });
    await postWebhook(app, payload, e, "errado");

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-hottok-ruim"))
      .get();
    expect(row).toBeUndefined();
  });

  it("400 com corpo que não é JSON", async () => {
    const { env: e } = testEnv();
    const res = await app.request(
      "/webhooks/hotmart",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hotmart-hottok": "test-hottok",
        },
        body: "isto não é json",
      },
      e,
    );
    expect(res.status).toBe(400);
  });

  it("400 quando falta o id do evento", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, { event: "PURCHASE_APPROVED" }, e);
    expect(res.status).toBe(400);
  });

  it("aceita campos desconhecidos (parse tolerante)", async () => {
    const { env: e } = testEnv();
    const payload = {
      ...purchaseApproved({ id: "evt-tolerante" }),
      campo_novo_da_hotmart: { qualquer: "coisa" },
    };
    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);
  });

  it("reenvio do mesmo id devolve duplicate e não reprocessa", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({ id: "evt-dup" });

    const first = await postWebhook(app, payload, e);
    const second = await postWebhook(app, payload, e);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
  });

  it("ucode fora da lista é ignorado", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-outro-produto",
      ucode: "UCODE_DE_OUTRO_PRODUTO",
    });

    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-outro-produto"))
      .get();
    expect(row?.status).toBe("ignored");
  });

  it("PURCHASE_COMPLETE é registrado sem efeito no acesso", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-complete",
      event: "PURCHASE_COMPLETE",
    });

    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-complete"))
      .get();
    expect(row?.status).toBe("ignored");
    expect(row?.note).toContain("garantia");
  });

  it("evento com ucode válido mas sem subscriber code é ignorado", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-sem-subcode",
      subscriberCode: null,
    });

    await postWebhook(app, payload, e);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-sem-subcode"))
      .get();
    expect(row?.status).toBe("ignored");
  });
});
```

> Neste ponto os despachos ainda não existem, então `PURCHASE_APPROVED` com ucode válido cai no ramo "evento não tratado" e é marcado `ignored`. O teste `evt-dup` só verifica idempotência, e `evt-tolerante` só verifica 200 — nenhum dos dois afirma nada sobre provisionamento. A Task 10 os complementa.

- [ ] **Step 3: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/webhook-base.test.ts
```

Esperado: FAIL — a rota `/webhooks/hotmart` não existe (404).

- [ ] **Step 4: Criar `src/webhooks/hotmart.ts`**

```typescript
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env";
import { getSubscriptionUcodes } from "../config/env";
import { getDb } from "../db/client";
import { claimEvent, markProcessed, markIgnored } from "../db/webhookEvents";
import { equalStrings } from "../lib/constantTime";

/**
 * Schema tolerante: valida só os campos que consumimos e descarta o resto.
 * A Hotmart adiciona campos sem aviso, e o payload traz endereço, telefone e
 * dados de pagamento que NÃO queremos persistir (minimização LGPD).
 *
 * Cobre os dois formatos numa estrutura só:
 * - compra:       data.subscription.subscriber.code, data.purchase.date_next_charge
 * - cancelamento: data.subscriber.code,              data.date_next_charge
 */
export const hotmartEventSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  data: z
    .object({
      product: z.object({ ucode: z.string().optional() }).optional(),
      buyer: z
        .object({
          email: z.string().optional(),
          name: z.string().optional(),
          document: z.string().optional(),
        })
        .optional(),
      purchase: z
        .object({
          transaction: z.string().optional(),
          status: z.string().optional(),
          date_next_charge: z.number().optional(),
          recurrence_number: z.number().optional(),
        })
        .optional(),
      subscription: z
        .object({
          status: z.string().optional(),
          plan: z.object({ name: z.string().optional() }).optional(),
          subscriber: z.object({ code: z.string().optional() }).optional(),
        })
        .optional(),
      subscriber: z
        .object({
          code: z.string().optional(),
          email: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
      date_next_charge: z.number().optional(),
      cancellation_date: z.number().optional(),
    })
    .optional(),
});

export type HotmartEvent = z.infer<typeof hotmartEventSchema>;

/** Resultado do despacho de um evento. */
export type Outcome = { kind: "processed" } | { kind: "ignored"; note: string };

export const webhooks = new Hono<{ Bindings: Env }>();

webhooks.post("/hotmart", async (c) => {
  const provided = c.req.header("x-hotmart-hottok") ?? "";
  if (!equalStrings(provided, c.env.HOTMART_HOTTOK)) {
    return c.json({ error: "invalid_hottok" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = hotmartEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_payload" }, 400);
  }
  const event = parsed.data;

  const db = getDb(c.env);

  // Idempotência ANTES de qualquer efeito. Só 'processed'/'ignored' deduplicam.
  const claim = await claimEvent(db, event.id, event.event);
  if (claim === "already_done") {
    return c.json({ ok: true, duplicate: true });
  }

  // O evento só vira 'processed' no FIM. Se algo lançar daqui pra frente, a
  // linha fica em 'received', o Worker responde 5xx e a Hotmart retenta.
  const outcome = await dispatch(c.env, event);

  if (outcome.kind === "ignored") {
    await markIgnored(db, event.id, outcome.note);
  } else {
    await markProcessed(db, event.id);
  }

  return c.json({ ok: true });
});

async function dispatch(env: Env, event: HotmartEvent): Promise<Outcome> {
  if (event.event === "PURCHASE_COMPLETE") {
    return { kind: "ignored", note: "fim da garantia — sem efeito no acesso" };
  }

  // Os demais eventos são despachados nas Tasks 10 e 11.
  return { kind: "ignored", note: `evento não tratado: ${event.event}` };
}

/**
 * O ucode só existe no payload de COMPRA. O cancelamento não o traz — lá o
 * casamento é pela PK subscriber_code.
 */
export function isSubscriptionProduct(env: Env, event: HotmartEvent): boolean {
  const ucode = event.data?.product?.ucode;
  return !!ucode && getSubscriptionUcodes(env).includes(ucode);
}
```

- [ ] **Step 5: Montar a rota em `src/app.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";
import { webhooks } from "./webhooks/hotmart";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);
app.route("/webhooks", webhooks);

export default app;
```

- [ ] **Step 6: Rodar os testes**

```bash
cd api && npx vitest run test/webhook-base.test.ts && npm run typecheck
```

Esperado: PASS (10 testes). Os testes de `ucode fora da lista` e `sem subscriber code` passam porque tudo que não é `PURCHASE_COMPLETE` cai no ramo genérico `ignored` — a Task 10 os torna significativos.

- [ ] **Step 7: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): rota do webhook com hottok, Zod tolerante e idempotência

hottok comparado em tempo constante; evento inválido não chega a ser
registrado. Schema Zod valida só os campos consumidos e descarta
endereço, telefone e pagamento (minimização LGPD).

O evento só é marcado 'processed' no fim: falha no meio deixa 'received'
e responde 5xx, para que a retentativa da Hotmart reprocesse.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Webhook — `PURCHASE_APPROVED` cria a conta e envia o link

O coração da fase. É aqui que a compra vira conta. Quatro guardas decidem se o email sai: senha ainda não definida, sem token pendente, primeira recorrência, e email fora da tombstone.

**Files:**
- Modify: `src/webhooks/hotmart.ts`
- Test: `test/webhook-purchase.test.ts`

**Interfaces:**
- Consumes: `upsertUserFromPurchase`, `findUserByEmail` (Task 4); `upsertSubscription` (Task 5); `createToken`, `hasPendingToken`, `FIRST_ACCESS_TTL_MS` (Task 6); `isDeleted`, `clearTombstone` (Task 7); `sendMagicLink` (Task 8); `normalizeEmail`, `normalizeDocument`, `hmacHex` (Task 3).
- Produces: `const NO_NEXT_CHARGE_FALLBACK_MS = 604_800_000` exportado de `src/webhooks/hotmart.ts`.

- [ ] **Step 1: Escrever o teste que falha**

`test/webhook-purchase.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { findUserByEmail, setPasswordHash } from "../src/db/users";
import { findSubscriptionByCode } from "../src/db/subscriptions";
import { markDeleted, isDeleted } from "../src/db/deletedAccounts";
import { hmacHex, normalizeDocument } from "../src/lib/hmac";
import { fakeEmailSender, envWith } from "./helpers";
import { purchaseApproved, postWebhook } from "./fixtures/hotmart";

const db = () => getDb(env);

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

const hashOf = (email: string) => hmacHex(email, env.DOCUMENT_HMAC_KEY);

describe("PURCHASE_APPROVED", () => {
  it("cria usuário e assinatura e envia o link mágico", async () => {
    const { sent, env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "novo-aluno@test.com",
        subscriberCode: "SUB-P1",
        name: "Aluno Novo",
      }),
      e,
    );

    const user = await findUserByEmail(db(), "novo-aluno@test.com");
    expect(user).toBeDefined();
    expect(user?.name).toBe("Aluno Novo");
    expect(user?.role).toBe("user");
    expect(user?.passwordHash).toBeNull();

    const sub = await findSubscriptionByCode(db(), "SUB-P1");
    expect(sub?.userId).toBe(user!.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.planName).toBe("Mensal");
    expect(sub?.lastTransaction).toBe("HP17715690036014");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("novo-aluno@test.com");
    expect(sent[0].subject.toLowerCase()).toContain("acesso");
  });

  it("normaliza o email do comprador", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "  MAIUSCULO@Test.COM  ",
        subscriberCode: "SUB-P2",
      }),
      e,
    );

    expect(await findUserByEmail(db(), "maiusculo@test.com")).toBeDefined();
  });

  it("grava o documento só como HMAC, nunca em claro", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "com-doc@test.com",
        subscriberCode: "SUB-P3",
        document: "123.456.789-09",
      }),
      e,
    );

    const user = await findUserByEmail(db(), "com-doc@test.com");
    expect(user?.documentHash).toBe(
      await hmacHex(normalizeDocument("123.456.789-09"), env.DOCUMENT_HMAC_KEY),
    );
    expect(user?.documentHash).not.toContain("123");
  });

  it("aceita compra sem documento (checkout que não pede CPF)", async () => {
    const { sent, env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "sem-doc@test.com",
        subscriberCode: "SUB-P4",
        document: null,
      }),
      e,
    );

    const user = await findUserByEmail(db(), "sem-doc@test.com");
    expect(user).toBeDefined();
    expect(user?.documentHash).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("usa date_next_charge como access_until", async () => {
    const { env: e } = testEnv();
    const nextCharge = Date.now() + 30 * 86400000;
    await postWebhook(
      app,
      purchaseApproved({
        email: "com-data@test.com",
        subscriberCode: "SUB-P5",
        dateNextCharge: nextCharge,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), "SUB-P5");
    expect(sub?.accessUntil?.getTime()).toBe(nextCharge);
  });

  it("sem date_next_charge, cai no fallback curto de 7 dias", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "sem-data@test.com",
        subscriberCode: "SUB-P6",
        dateNextCharge: null,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), "SUB-P6");
    const delta = sub!.accessUntil!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(6 * 86400000);
    expect(delta).toBeLessThanOrEqual(7 * 86400000);
  });

  it("concede admin pela allowlist, nunca pelo payload", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "admin@test.com", subscriberCode: "SUB-P7" }),
      e,
    );

    const user = await findUserByEmail(db(), "admin@test.com");
    expect(user?.role).toBe("admin");
  });

  it("renovação (recurrence_number=2) estende o acesso sem reenviar email", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "renova@test.com",
        subscriberCode: "SUB-P8",
        recurrenceNumber: 1,
      }),
      first.env,
    );
    expect(first.sent).toHaveLength(1);

    const renewal = testEnv();
    const novoAcesso = Date.now() + 60 * 86400000;
    await postWebhook(
      app,
      purchaseApproved({
        email: "renova@test.com",
        subscriberCode: "SUB-P8",
        recurrenceNumber: 2,
        dateNextCharge: novoAcesso,
      }),
      renewal.env,
    );

    expect(renewal.sent).toHaveLength(0);
    const sub = await findSubscriptionByCode(db(), "SUB-P8");
    expect(sub?.accessUntil?.getTime()).toBe(novoAcesso);
  });

  it("não reenvia link se já existe um token pendente", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "pendente@test.com",
        subscriberCode: "SUB-P9",
      }),
      first.env,
    );
    expect(first.sent).toHaveLength(1);

    // outro evento (id diferente), mesmo comprador, ainda sem senha definida
    const second = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "pendente@test.com",
        subscriberCode: "SUB-P9",
      }),
      second.env,
    );
    expect(second.sent).toHaveLength(0);
  });

  it("não envia link para quem já definiu senha", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "ja-tem-senha@test.com",
        subscriberCode: "SUB-P10",
      }),
      first.env,
    );

    const user = await findUserByEmail(db(), "ja-tem-senha@test.com");
    await setPasswordHash(db(), user!.id, "pbkdf2$sha256$100000$s$h");

    const second = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "ja-tem-senha@test.com",
        subscriberCode: "SUB-P10",
      }),
      second.env,
    );
    expect(second.sent).toHaveLength(0);
  });

  it("segunda assinatura do mesmo aluno cria segunda linha (1:N)", async () => {
    const e1 = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "duas-subs@test.com", subscriberCode: "SUB-P11a" }),
      e1.env,
    );
    const e2 = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "duas-subs@test.com", subscriberCode: "SUB-P11b" }),
      e2.env,
    );

    const user = await findUserByEmail(db(), "duas-subs@test.com");
    const a = await findSubscriptionByCode(db(), "SUB-P11a");
    const b = await findSubscriptionByCode(db(), "SUB-P11b");

    expect(a?.userId).toBe(user!.id);
    expect(b?.userId).toBe(user!.id);
  });
});

describe("PURCHASE_APPROVED com tombstone", () => {
  it("renovação de conta excluída é ignorada e não recria o usuário", async () => {
    const { sent, env: e } = testEnv();
    await markDeleted(db(), await hashOf("excluido@test.com"));

    await postWebhook(
      app,
      purchaseApproved({
        email: "excluido@test.com",
        subscriberCode: "SUB-P12",
        recurrenceNumber: 2,
      }),
      e,
    );

    expect(await findUserByEmail(db(), "excluido@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("compra NOVA limpa a tombstone e provisiona como cliente novo", async () => {
    const { sent, env: e } = testEnv();
    await markDeleted(db(), await hashOf("voltou@test.com"));

    await postWebhook(
      app,
      purchaseApproved({
        email: "voltou@test.com",
        subscriberCode: "SUB-P13",
        recurrenceNumber: 1,
      }),
      e,
    );

    expect(await findUserByEmail(db(), "voltou@test.com")).toBeDefined();
    expect(await isDeleted(db(), await hashOf("voltou@test.com"))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/webhook-purchase.test.ts
```

Esperado: FAIL — nenhum usuário é criado; `PURCHASE_APPROVED` ainda cai no ramo genérico `ignored`.

- [ ] **Step 3: Implementar o despacho em `src/webhooks/hotmart.ts`**

Adicionar os imports no topo do arquivo:

```typescript
import { getAdminEmails } from "../config/env";
import { upsertUserFromPurchase, findUserByEmail } from "../db/users";
import { upsertSubscription } from "../db/subscriptions";
import {
  createToken,
  hasPendingToken,
  FIRST_ACCESS_TTL_MS,
} from "../db/authTokens";
import { isDeleted, clearTombstone } from "../db/deletedAccounts";
import { sendMagicLink } from "../lib/email";
import { normalizeEmail, normalizeDocument, hmacHex } from "../lib/hmac";
```

Adicionar a constante e a função de tratamento, e trocar o corpo de `dispatch`:

```typescript
/**
 * Fallback quando `date_next_charge` não vem no payload (o campo é opcional).
 * Curto de propósito: a periodicidade do plano não está no payload de compra,
 * só na API de dados. O cron corrige na primeira execução. O erro possível é
 * dar acesso de menos por até 24h a quem pagou — nunca acesso indefinido a
 * quem não pagou.
 */
export const NO_NEXT_CHARGE_FALLBACK_MS = 604_800_000; // 7 dias

async function handlePurchaseApproved(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  if (!isSubscriptionProduct(env, event)) {
    return { kind: "ignored", note: "ucode fora de HOTMART_SUBSCRIPTION_UCODES" };
  }

  const subscriberCode = event.data?.subscription?.subscriber?.code;
  if (!subscriberCode) {
    return { kind: "ignored", note: "compra sem subscriber.code" };
  }

  const rawEmail = event.data?.buyer?.email;
  if (!rawEmail) {
    return { kind: "ignored", note: "compra sem email do comprador" };
  }

  const db = getDb(env);
  const email = normalizeEmail(rawEmail);
  const emailHash = await hmacHex(email, env.DOCUMENT_HMAC_KEY);
  const recurrence = event.data?.purchase?.recurrence_number ?? 1;

  // Tombstone: renovação de conta excluída não ressuscita ninguém. Compra nova
  // sim — a tombstone não é banimento perpétuo.
  if (await isDeleted(db, emailHash)) {
    if (recurrence > 1) {
      return { kind: "ignored", note: "conta excluída pelo titular" };
    }
    await clearTombstone(db, emailHash);
  }

  const rawDocument = event.data?.buyer?.document;
  const documentHash = rawDocument
    ? await hmacHex(normalizeDocument(rawDocument), env.DOCUMENT_HMAC_KEY)
    : null;

  const userId = await upsertUserFromPurchase(
    db,
    { email, name: event.data?.buyer?.name ?? null, documentHash },
    getAdminEmails(env),
  );

  const nextCharge = event.data?.purchase?.date_next_charge;
  const accessUntil = nextCharge
    ? new Date(nextCharge)
    : new Date(Date.now() + NO_NEXT_CHARGE_FALLBACK_MS);

  await upsertSubscription(db, {
    subscriberCode,
    userId,
    productUcode: event.data!.product!.ucode!,
    planName: event.data?.subscription?.plan?.name ?? null,
    status: event.data?.subscription?.status ?? "ACTIVE",
    accessUntil,
    lastTransaction: event.data?.purchase?.transaction ?? null,
  });

  // Quatro guardas antes de enviar: senha não definida, primeira recorrência,
  // sem token válido pendente. O envio é awaited — se falhar, a exceção sobe,
  // o evento fica em 'received' e a Hotmart retenta.
  const user = await findUserByEmail(db, email);
  const precisaDefinirSenha = user?.passwordHash == null;
  if (precisaDefinirSenha && recurrence === 1) {
    if (!(await hasPendingToken(db, userId))) {
      const token = await createToken(db, userId, FIRST_ACCESS_TTL_MS);
      await sendMagicLink(env, {
        to: email,
        name: user?.name ?? null,
        token,
        kind: "first_access",
      });
    }
  }

  return { kind: "processed" };
}
```

Substituir `dispatch` por:

```typescript
async function dispatch(env: Env, event: HotmartEvent): Promise<Outcome> {
  switch (event.event) {
    case "PURCHASE_APPROVED":
      return handlePurchaseApproved(env, event);
    case "PURCHASE_COMPLETE":
      return { kind: "ignored", note: "fim da garantia — sem efeito no acesso" };
    default:
      return { kind: "ignored", note: `evento não tratado: ${event.event}` };
  }
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: `test/webhook-purchase.test.ts` passa (13 testes) e `test/webhook-base.test.ts` continua passando — agora os testes de ucode e de subscriber code ausente exercitam ramos reais.

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): PURCHASE_APPROVED provisiona a conta e envia o link mágico

A compra é a única porta de entrada: cria o usuário, a assinatura e
dispara o link de definição de senha. Quatro guardas antes do envio —
senha ainda não definida, primeira recorrência, sem token pendente e
email fora da tombstone.

Sem date_next_charge, access_until cai num fallback curto de 7 dias que
o cron corrige: erra dando acesso de menos a quem pagou, nunca acesso
indefinido a quem não pagou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Webhook — revogação e cancelamento

Todos os eventos restantes. Revogar é sempre escrever `access_until` — nunca há lógica de status na autorização.

**Files:**
- Modify: `src/webhooks/hotmart.ts`
- Test: `test/webhook-revocation.test.ts`

**Interfaces:**
- Consumes: `findSubscriptionByCode`, `revokeAccess`, `setStatus`, `setAccessUntil` (Task 5).
- Produces: nada novo além do comportamento dos eventos.

- [ ] **Step 1: Escrever o teste que falha**

`test/webhook-revocation.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import { findUserByEmail, loadEntitlement } from "../src/db/users";
import { findSubscriptionByCode } from "../src/db/subscriptions";
import { fakeEmailSender, envWith } from "./helpers";
import {
  purchaseApproved,
  subscriptionCancellation,
  postWebhook,
} from "./fixtures/hotmart";

const db = () => getDb(env);

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

/** Cria uma assinatura ativa e devolve o código. */
async function assinaturaAtiva(
  email: string,
  code: string,
  dateNextCharge = Date.now() + 30 * 86400000,
): Promise<string> {
  const { env: e } = testEnv();
  await postWebhook(
    app,
    purchaseApproved({ email, subscriberCode: code, dateNextCharge }),
    e,
  );
  return code;
}

describe("eventos de revogação", () => {
  it.each([
    ["PURCHASE_REFUNDED", "REFUNDED"],
    ["PURCHASE_CHARGEBACK", "CHARGEBACK"],
    ["PURCHASE_PROTEST", "PROTEST"],
  ])("%s revoga o acesso imediatamente", async (evento, statusEsperado) => {
    const code = `SUB-REV-${evento}`;
    await assinaturaAtiva(`${evento.toLowerCase()}@test.com`, code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: evento, subscriberCode: code }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe(statusEsperado);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("revogação derruba o tier para gratuito", async () => {
    const code = "SUB-REV-TIER";
    await assinaturaAtiva("tier-revogado@test.com", code);

    const user = await findUserByEmail(db(), "tier-revogado@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_REFUNDED", subscriberCode: code }),
      e,
    );

    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("gratuito");
  });

  it("PURCHASE_DELAYED marca o status mas PRESERVA access_until", async () => {
    const code = "SUB-DELAYED";
    const acesso = Date.now() + 20 * 86400000;
    await assinaturaAtiva("atrasado@test.com", code, acesso);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_DELAYED", subscriberCode: code }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe("DELAYED");
    expect(sub?.accessUntil?.getTime()).toBe(acesso);

    const user = await findUserByEmail(db(), "atrasado@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");
  });

  it("PURCHASE_EXPIRED marca EXPIRED quando a assinatura existe", async () => {
    const code = "SUB-EXPIRED";
    await assinaturaAtiva("expirou@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_EXPIRED", subscriberCode: code }),
      e,
    );

    expect((await findSubscriptionByCode(db(), code))?.status).toBe("EXPIRED");
  });

  it("evento de revogação para código desconhecido é ignorado", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        id: "evt-rev-desconhecido",
        event: "PURCHASE_REFUNDED",
        subscriberCode: "SUB-QUE-NAO-EXISTE",
      }),
      e,
    );

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-rev-desconhecido"))
      .get();
    expect(row?.status).toBe("ignored");
  });
});

describe("SUBSCRIPTION_CANCELLATION", () => {
  it("mantém o acesso até date_next_charge (fim do ciclo pago)", async () => {
    const code = "SUB-CANCEL-1";
    await assinaturaAtiva("cancelou@test.com", code);

    const fimDoCiclo = Date.now() + 15 * 86400000;
    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({
        subscriberCode: code,
        dateNextCharge: fimDoCiclo,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe("CANCELLED");
    expect(sub?.accessUntil?.getTime()).toBe(fimDoCiclo);

    // ainda assinante: o ciclo pago não acabou
    const user = await findUserByEmail(db(), "cancelou@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");
  });

  it("sem date_next_charge, revoga na hora", async () => {
    const code = "SUB-CANCEL-2";
    await assinaturaAtiva("cancelou-sem-data@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({ subscriberCode: code, dateNextCharge: null }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("date_next_charge no passado revoga na hora", async () => {
    const code = "SUB-CANCEL-3";
    await assinaturaAtiva("cancelou-passado@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({
        subscriberCode: code,
        dateNextCharge: Date.now() - 86400000,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("subscriber code desconhecido é ignorado sem erro", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(
      app,
      subscriptionCancellation({
        id: "evt-cancel-desconhecido",
        subscriberCode: "SUB-DE-OUTRO-SISTEMA",
      }),
      e,
    );
    expect(res.status).toBe(200);

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-cancel-desconhecido"))
      .get();
    expect(row?.status).toBe("ignored");
  });

  it("funciona sem product.ucode no payload (que o cancelamento não traz)", async () => {
    const code = "SUB-CANCEL-4";
    await assinaturaAtiva("cancel-sem-ucode@test.com", code);

    const payload = subscriptionCancellation({ subscriberCode: code });
    expect((payload.data.product as Record<string, unknown>).ucode).toBeUndefined();

    const { env: e } = testEnv();
    await postWebhook(app, payload, e);

    expect((await findSubscriptionByCode(db(), code))?.status).toBe("CANCELLED");
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/webhook-revocation.test.ts
```

Esperado: FAIL — todos esses eventos ainda caem no ramo genérico `ignored`.

- [ ] **Step 3: Implementar os handlers em `src/webhooks/hotmart.ts`**

Acrescentar aos imports:

```typescript
import {
  findSubscriptionByCode,
  revokeAccess,
  setStatus,
  setAccessUntil,
} from "../db/subscriptions";
```

Acrescentar as funções:

```typescript
/** Eventos de compra que revogam acesso, e o status que cada um grava. */
const REVOKING_EVENTS: Record<string, string> = {
  PURCHASE_REFUNDED: "REFUNDED",
  PURCHASE_CHARGEBACK: "CHARGEBACK",
  PURCHASE_PROTEST: "PROTEST",
};

/**
 * O subscriber code de um evento de compra. Diferente do cancelamento, que o
 * traz um nível acima (data.subscriber.code).
 */
function purchaseSubscriberCode(event: HotmartEvent): string | undefined {
  return event.data?.subscription?.subscriber?.code;
}

async function handleRevocation(
  env: Env,
  event: HotmartEvent,
  status: string,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  await revokeAccess(db, code, status);
  return { kind: "processed" };
}

/**
 * Atraso não corta acesso: o ciclo já pago continua valendo. Só o status muda,
 * e `access_until` fica intocado — a carência é consequência natural do
 * predicado de data.
 */
async function handleDelayed(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  await setStatus(db, code, "DELAYED");
  return { kind: "processed" };
}

/** Boleto/Pix não pago. Só marca se a assinatura já existir. */
async function handleExpired(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "assinatura nunca ativada" };
  }

  await setStatus(db, code, "EXPIRED");
  return { kind: "processed" };
}

/**
 * Cancelamento. NÃO filtra por ucode: o payload não traz product.ucode, só
 * product.id e product.name. O casamento pela PK subscriber_code já garante
 * que a assinatura é nossa — código desconhecido é ignorado com segurança.
 *
 * O acesso vale até date_next_charge, que na assinatura cancelada é a data do
 * último acesso pago (documentação da Hotmart).
 */
async function handleCancellation(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = event.data?.subscriber?.code;
  if (!code) {
    return { kind: "ignored", note: "cancelamento sem subscriber.code" };
  }

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  const nextCharge = event.data?.date_next_charge;
  if (nextCharge && nextCharge > Date.now()) {
    await setStatus(db, code, "CANCELLED");
    await setAccessUntil(db, code, new Date(nextCharge));
  } else {
    await revokeAccess(db, code, "CANCELLED");
  }

  return { kind: "processed" };
}
```

Substituir `dispatch` pela versão final:

```typescript
async function dispatch(env: Env, event: HotmartEvent): Promise<Outcome> {
  const revokingStatus = REVOKING_EVENTS[event.event];
  if (revokingStatus) return handleRevocation(env, event, revokingStatus);

  switch (event.event) {
    case "PURCHASE_APPROVED":
      return handlePurchaseApproved(env, event);
    case "PURCHASE_DELAYED":
      return handleDelayed(env, event);
    case "PURCHASE_CANCELED":
    case "PURCHASE_EXPIRED":
      return handleExpired(env, event);
    case "SUBSCRIPTION_CANCELLATION":
      return handleCancellation(env, event);
    case "PURCHASE_COMPLETE":
      return { kind: "ignored", note: "fim da garantia — sem efeito no acesso" };
    default:
      return { kind: "ignored", note: `evento não tratado: ${event.event}` };
  }
}
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: `test/webhook-revocation.test.ts` passa (11 testes), toda a suíte verde.

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): revogação e cancelamento no webhook

Reembolso, chargeback e protesto revogam escrevendo access_until no
passado. Atraso só muda o status — a carência é consequência natural do
predicado de data.

Cancelamento casa pela PK subscriber_code, sem filtrar ucode (o payload
não o traz), e mantém acesso até date_next_charge: quem cancela no dia
20 de um ciclo cobrado no dia 10 fica até o dia 10 seguinte.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `POST /auth/set-password` — o primeiro acesso

Consome o link mágico e já emite a sessão: o aluno sai da tela logado, sem precisar digitar a senha que acabou de criar.

**Files:**
- Modify: `src/routes/auth.ts`
- Test: `test/auth-set-password.test.ts`

**Interfaces:**
- Consumes: `consumeToken`, `createToken`, `FIRST_ACCESS_TTL_MS` (Task 6); `setPasswordHash`, `findUserByEmail`, `upsertUserFromPurchase` (Task 4); `hashPassword`, `verifyPassword` (Task 3); `signSession` (`src/lib/jwt.ts`); `setSessionCookie` (Task 1).
- Produces: `const MIN_PASSWORD_LENGTH = 8` exportado de `src/routes/auth.ts`.

- [ ] **Step 1: Escrever o teste que falha**

`test/auth-set-password.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase, findUserByEmail } from "../src/db/users";
import { createToken, FIRST_ACCESS_TTL_MS } from "../src/db/authTokens";
import { hashToken } from "../src/lib/tokens";
import { verifyPassword } from "../src/lib/password";
import { cookieFrom } from "./helpers";

const db = () => getDb(env);

async function userComToken(email: string): Promise<{ id: string; token: string }> {
  const id = await upsertUserFromPurchase(
    db(),
    { email, name: "Aluno", documentHash: null },
    [],
  );
  return { id, token: await createToken(db(), id, FIRST_ACCESS_TTL_MS) };
}

function setPassword(token: string, password: string) {
  return app.request(
    "/auth/set-password",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    },
    env,
  );
}

describe("POST /auth/set-password", () => {
  it("define a senha e já emite a sessão", async () => {
    const { id, token } = await userComToken("sp1@test.com");

    const res = await setPassword(token, "senha-forte-1");
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "session")).toBeTruthy();

    const user = await findUserByEmail(db(), "sp1@test.com");
    expect(user!.id).toBe(id);
    expect(user!.passwordHash).toBeTruthy();
    expect(await verifyPassword("senha-forte-1", user!.passwordHash!)).toBe(true);
  });

  it("a sessão emitida funciona no /auth/me", async () => {
    const { token } = await userComToken("sp2@test.com");
    const res = await setPassword(token, "senha-forte-2");
    const session = cookieFrom(res, "session")!;

    const me = await app.request(
      "/auth/me",
      { headers: { cookie: session } },
      env,
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email: "sp2@test.com",
      role: "user",
      tier: "gratuito",
    });
  });

  it("400 com token inexistente", async () => {
    const res = await setPassword("token-que-nunca-existiu", "senha-forte-3");
    expect(res.status).toBe(400);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com token já usado", async () => {
    const { token } = await userComToken("sp3@test.com");
    expect((await setPassword(token, "senha-forte-4")).status).toBe(200);
    expect((await setPassword(token, "outra-senha-5")).status).toBe(400);
  });

  it("400 com token expirado", async () => {
    const { token } = await userComToken("sp4@test.com");
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect((await setPassword(token, "senha-forte-6")).status).toBe(400);
  });

  it("400 com senha menor que 8 caracteres, sem queimar o token", async () => {
    const { token } = await userComToken("sp5@test.com");

    const curta = await setPassword(token, "1234567");
    expect(curta.status).toBe(400);

    // o token continua válido: o aluno pode tentar de novo
    expect((await setPassword(token, "senha-valida")).status).toBe(200);
  });

  it("400 com corpo malformado", async () => {
    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "não é json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 quando falta o campo token", async () => {
    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "senha-forte-7" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("usar um token invalida os demais do mesmo usuário", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "sp6@test.com", name: null, documentHash: null },
      [],
    );
    const antigo = await createToken(db(), id, FIRST_ACCESS_TTL_MS);
    const novo = await createToken(db(), id, FIRST_ACCESS_TTL_MS);

    expect((await setPassword(novo, "senha-forte-8")).status).toBe(200);
    expect((await setPassword(antigo, "senha-forte-9")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/auth-set-password.test.ts
```

Esperado: FAIL — a rota não existe (404).

- [ ] **Step 3: Adicionar a rota em `src/routes/auth.ts`**

Imports no topo:

```typescript
import { z } from "zod";
import { getDb } from "../db/client";
import { setPasswordHash } from "../db/users";
import { consumeToken } from "../db/authTokens";
import { hashPassword } from "../lib/password";
import { signSession } from "../lib/jwt";
import { setSessionCookie, clearSessionCookie } from "../lib/cookies";
```

Corpo:

```typescript
/** Recomendação NIST atual: comprimento, sem regras de composição. */
export const MIN_PASSWORD_LENGTH = 8;

const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string(),
});

auth.post("/set-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  // Validar a senha ANTES de consumir o token: senha curta não pode queimar o
  // link do aluno e obrigá-lo a pedir outro.
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: "weak_password" }, 400);
  }

  const db = getDb(c.env);
  const userId = await consumeToken(db, parsed.data.token);
  if (!userId) return c.json({ error: "invalid_token" }, 400);

  await setPasswordHash(db, userId, await hashPassword(parsed.data.password));
  setSessionCookie(c, await signSession(userId, c.env.JWT_SECRET));

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npx vitest run test/auth-set-password.test.ts && npm run typecheck
```

Esperado: PASS (9 testes). O teste "senha curta não queima o token" é o que trava a ordem das validações.

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): POST /auth/set-password consome o link e emite a sessão

A validação de comprimento vem antes do consumo do token: senha curta
não pode queimar o link do aluno. Ao definir a senha o aluno já sai
logado, sem digitar de novo o que acabou de criar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `POST /auth/login` e as rotas de sessão

Turnstile, resposta genérica e a defesa contra o oráculo de tempo — se pularmos o PBKDF2 quando o usuário não existe, o tempo de resposta denuncia quais emails têm conta, anulando a resposta genérica.

**Files:**
- Modify: `src/routes/auth.ts`
- Test: `test/auth-login.test.ts`

**Interfaces:**
- Consumes: `verifyTurnstile` (Task 8); `verifyPassword` (Task 3); `findUserByEmail`, `setPasswordHash` (Task 4); `normalizeEmail` (Task 3); `stubTurnstile`, `cookieFrom` (Task 8).
- Produces: nada novo além das rotas.

- [ ] **Step 1: Escrever o teste que falha**

`test/auth-login.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase, setPasswordHash } from "../src/db/users";
import { upsertSubscription } from "../src/db/subscriptions";
import { hashPassword } from "../src/lib/password";
import { stubTurnstile, cookieFrom } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function alunoComSenha(email: string, senha: string): Promise<string> {
  const id = await upsertUserFromPurchase(
    db(),
    { email, name: "Aluno", documentHash: null },
    [],
  );
  await setPasswordHash(db(), id, await hashPassword(senha));
  return id;
}

function login(email: string, password: string, turnstileToken = "tok") {
  return app.request(
    "/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, turnstileToken }),
    },
    env,
  );
}

describe("POST /auth/login", () => {
  it("autentica com a senha correta e emite a sessão", async () => {
    stubTurnstile(true);
    await alunoComSenha("login1@test.com", "senha-correta");

    const res = await login("login1@test.com", "senha-correta");
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "session")).toBeTruthy();
  });

  it("aceita email com espaços e maiúsculas", async () => {
    stubTurnstile(true);
    await alunoComSenha("login2@test.com", "senha-correta");

    const res = await login("  Login2@TEST.com  ", "senha-correta");
    expect(res.status).toBe(200);
  });

  it("401 genérico com senha errada", async () => {
    stubTurnstile(true);
    await alunoComSenha("login3@test.com", "senha-correta");

    const res = await login("login3@test.com", "senha-errada");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("401 IDÊNTICO para usuário inexistente (anti-enumeração)", async () => {
    stubTurnstile(true);
    await alunoComSenha("login4@test.com", "senha-correta");

    const errada = await login("login4@test.com", "senha-errada");
    const inexistente = await login("nao-existe@test.com", "qualquer-senha");

    expect(inexistente.status).toBe(errada.status);
    expect(await inexistente.json()).toEqual(await errada.json());
  });

  it("401 para usuário que nunca definiu senha", async () => {
    stubTurnstile(true);
    await upsertUserFromPurchase(
      db(),
      { email: "sem-senha@test.com", name: null, documentHash: null },
      [],
    );

    const res = await login("sem-senha@test.com", "qualquer-senha");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("403 quando o Turnstile reprova, sem sequer olhar a senha", async () => {
    stubTurnstile(false);
    await alunoComSenha("login5@test.com", "senha-correta");

    const res = await login("login5@test.com", "senha-correta");
    expect(res.status).toBe(403);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com corpo malformado", async () => {
    stubTurnstile(true);
    const res = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "não é json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("gasta tempo comparável em usuário inexistente (sem oráculo de tempo)", async () => {
    stubTurnstile(true);
    await alunoComSenha("login6@test.com", "senha-correta");

    const t0 = Date.now();
    await login("login6@test.com", "senha-errada");
    const comUsuario = Date.now() - t0;

    const t1 = Date.now();
    await login("nao-existe-nenhum@test.com", "senha-errada");
    const semUsuario = Date.now() - t1;

    // Se o caminho "sem usuário" pulasse o PBKDF2, seria ordens de grandeza
    // mais rápido. Margem generosa: o teste trava a intenção, não a latência.
    expect(semUsuario).toBeGreaterThan(comUsuario / 5);
  });
});

describe("GET /auth/me", () => {
  it("401 sem cookie", async () => {
    const res = await app.request("/auth/me", {}, env);
    expect(res.status).toBe(401);
  });

  it("401 com cookie inválido", async () => {
    const res = await app.request(
      "/auth/me",
      { headers: { cookie: "session=lixo" } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("devolve o perfil e o tier derivado da assinatura", async () => {
    stubTurnstile(true);
    const id = await alunoComSenha("me1@test.com", "senha-correta");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-ME-1",
      userId: id,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    });

    const session = cookieFrom(await login("me1@test.com", "senha-correta"), "session")!;
    const me = await app.request("/auth/me", { headers: { cookie: session } }, env);

    expect(await me.json()).toEqual({
      id,
      email: "me1@test.com",
      name: "Aluno",
      role: "user",
      tier: "assinante",
    });
  });
});

describe("POST /auth/logout", () => {
  it("limpa o cookie de sessão", async () => {
    const res = await app.request("/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/auth-login.test.ts
```

Esperado: FAIL — `POST /auth/login` não existe (404).

- [ ] **Step 3: Adicionar a rota em `src/routes/auth.ts`**

Acrescentar aos imports:

```typescript
import { findUserByEmail } from "../db/users";
import { verifyPassword } from "../lib/password";
import { verifyTurnstile } from "../lib/turnstile";
import { normalizeEmail } from "../lib/hmac";
```

Corpo:

```typescript
/**
 * Hash descartável, usado quando o email não tem conta ou nunca definiu senha.
 * Sem ele, o caminho "usuário inexistente" retornaria sem rodar PBKDF2 e o
 * tempo de resposta viraria um oráculo de existência de conta — anulando a
 * resposta genérica. Gerado com hashPassword("dummy") uma vez.
 */
const DUMMY_HASH =
  "pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string(),
  turnstileToken: z.string().optional(),
});

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const captchaOk = await verifyTurnstile(
    c.env,
    parsed.data.turnstileToken ?? "",
    c.req.header("cf-connecting-ip"),
  );
  if (!captchaOk) return c.json({ error: "captcha_failed" }, 403);

  const email = normalizeEmail(parsed.data.email);
  const user = await findUserByEmail(getDb(c.env), email);

  // Sempre roda o PBKDF2, exista o usuário ou não.
  const ok = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!ok || !user || !user.passwordHash) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  setSessionCookie(c, await signSession(user.id, c.env.JWT_SECRET));
  return c.json({ ok: true });
});
```

> `DUMMY_HASH` precisa ser um hash **estruturalmente válido**, senão `verifyPassword` retorna cedo no parse e o custo desaparece. O valor acima tem salt e hash de tamanho correto em base64. Se o teste de tempo falhar, verificar que `verifyPassword("x", DUMMY_HASH)` demora o mesmo que contra um hash real.

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: PASS (12 testes no arquivo, suíte inteira verde).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): POST /auth/login com Turnstile e resposta genérica

Erro sempre 401 invalid_credentials — senha errada, usuário inexistente e
usuário sem senha definida respondem idêntico.

O PBKDF2 roda mesmo quando o email não tem conta, contra um hash
descartável: sem isso o tempo de resposta viraria oráculo de existência
de conta e anularia a resposta genérica.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: `POST /auth/recover` — recuperação de acesso

Sempre 200. O único ponto em que o resultado aparece é no email — e ele só chega a quem já é dono da caixa.

**Files:**
- Modify: `src/routes/auth.ts`
- Test: `test/auth-recover.test.ts`

**Interfaces:**
- Consumes: `issuedWithin`, `createToken`, `RECOVERY_TTL_MS`, `RECOVERY_COOLDOWN_MS` (Task 6); `isDeleted` (Task 7); `sendMagicLink` (Task 8); `hmacHex`, `normalizeDocument`, `normalizeEmail` (Task 3).
- Produces: nada novo.

- [ ] **Step 1: Escrever o teste que falha**

`test/auth-recover.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase } from "../src/db/users";
import { markDeleted } from "../src/db/deletedAccounts";
import { hmacHex, normalizeDocument } from "../src/lib/hmac";
import { fakeEmailSender, envWith, cookieFrom } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOC = "123.456.789-09";

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Stub que aprova o Turnstile e deixa o resto do fetch estourar. */
function stubCaptcha(success = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === TURNSTILE_URL) {
        return new Response(JSON.stringify({ success }), { status: 200 });
      }
      throw new Error("fetch inesperado: " + String(input));
    }),
  );
}

async function alunoComDocumento(email: string, doc: string | null) {
  return upsertUserFromPurchase(
    db(),
    {
      email,
      name: "Aluno",
      documentHash: doc
        ? await hmacHex(normalizeDocument(doc), env.DOCUMENT_HMAC_KEY)
        : null,
    },
    [],
  );
}

function recover(
  e: unknown,
  email: string,
  document: string,
  turnstileToken = "tok",
) {
  return app.request(
    "/auth/recover",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, document, turnstileToken }),
    },
    e,
  );
}

async function tokensDe(userId: string) {
  return db()
    .select()
    .from(authTokens)
    .where(eq(authTokens.userId, userId))
    .all();
}

describe("POST /auth/recover", () => {
  it("dados corretos: 200 e envia o link de recuperação", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec1@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec1@test.com", DOC);

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("rec1@test.com");
    expect(sent[0].subject.toLowerCase()).toContain("recupera");
    expect(await tokensDe(id)).toHaveLength(1);
  });

  it("email inexistente: 200 idêntico, sem email enviado", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();

    const ok = await recover(envWith({ EMAIL: sender }), "nao-existe@test.com", DOC);

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("documento errado: 200 idêntico, sem email enviado", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec2@test.com", DOC);

    const res = await recover(
      envWith({ EMAIL: sender }),
      "rec2@test.com",
      "999.999.999-99",
    );

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await tokensDe(id)).toHaveLength(0);
  });

  it("aceita o documento com ou sem máscara", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec3@test.com", DOC);

    await recover(envWith({ EMAIL: sender }), "rec3@test.com", "12345678909");
    expect(sent).toHaveLength(1);
  });

  it("usuário sem documento cadastrado: valida só o email", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec4@test.com", null);

    await recover(
      envWith({ EMAIL: sender }),
      "rec4@test.com",
      "qualquer-documento",
    );
    expect(sent).toHaveLength(1);
  });

  it("cooldown: segunda chamada em 5 min não emite token novo", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec5@test.com", DOC);
    const e = envWith({ EMAIL: sender });

    await recover(e, "rec5@test.com", DOC);
    const segunda = await recover(e, "rec5@test.com", DOC);

    expect(segunda.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(await tokensDe(id)).toHaveLength(1);
  });

  it("conta excluída: 200 idêntico, sem email", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec6@test.com", DOC);
    await markDeleted(db(), await hmacHex("rec6@test.com", env.DOCUMENT_HMAC_KEY));

    const res = await recover(envWith({ EMAIL: sender }), "rec6@test.com", DOC);

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("403 quando o Turnstile reprova", async () => {
    stubCaptcha(false);
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec7@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec7@test.com", DOC);

    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("nunca emite sessão", async () => {
    stubCaptcha();
    const { sender } = fakeEmailSender();
    await alunoComDocumento("rec8@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec8@test.com", DOC);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com corpo malformado", async () => {
    stubCaptcha();
    const { sender } = fakeEmailSender();
    const res = await app.request(
      "/auth/recover",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.com" }),
      },
      envWith({ EMAIL: sender }),
    );
    expect(res.status).toBe(400);
  });

  it("o token gerado serve para definir a senha", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec9@test.com", DOC);

    await recover(envWith({ EMAIL: sender }), "rec9@test.com", DOC);

    const match = sent[0].text.match(/token=([A-Za-z0-9_%-]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "nova-senha-forte" }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/auth-recover.test.ts
```

Esperado: FAIL — `POST /auth/recover` não existe (404).

- [ ] **Step 3: Adicionar a rota em `src/routes/auth.ts`**

Acrescentar aos imports:

```typescript
import {
  createToken,
  issuedWithin,
  RECOVERY_TTL_MS,
  RECOVERY_COOLDOWN_MS,
} from "../db/authTokens";
import { isDeleted } from "../db/deletedAccounts";
import { sendMagicLink } from "../lib/email";
import { hmacHex, normalizeDocument } from "../lib/hmac";
```

Corpo:

```typescript
const recoverSchema = z.object({
  email: z.string().min(1),
  document: z.string(),
  turnstileToken: z.string().optional(),
});

auth.post("/recover", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = recoverSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const captchaOk = await verifyTurnstile(
    c.env,
    parsed.data.turnstileToken ?? "",
    c.req.header("cf-connecting-ip"),
  );
  if (!captchaOk) return c.json({ error: "captcha_failed" }, 403);

  // Daqui pra frente a resposta é SEMPRE esta, aconteça o que acontecer.
  // O resultado real só aparece no email — que só chega a quem já é dono da
  // caixa. O documento não é segredo: serve como anti-spam, impedindo disparar
  // emails de recuperação para terceiros.
  const generic = () => c.json({ ok: true });

  const db = getDb(c.env);
  const email = normalizeEmail(parsed.data.email);

  if (await isDeleted(db, await hmacHex(email, c.env.DOCUMENT_HMAC_KEY))) {
    return generic();
  }

  const user = await findUserByEmail(db, email);
  if (!user) return generic();

  // Documento nulo = o checkout da Hotmart não pediu CPF. Validar só o email
  // evita trancar cliente pagante fora, e é invisível para atacante.
  if (user.documentHash) {
    const provided = await hmacHex(
      normalizeDocument(parsed.data.document),
      c.env.DOCUMENT_HMAC_KEY,
    );
    if (provided !== user.documentHash) return generic();
  }

  // Anti email-bombing de uma vítima cujo email e CPF o atacante conheça.
  if (await issuedWithin(db, user.id, RECOVERY_COOLDOWN_MS)) return generic();

  const token = await createToken(db, user.id, RECOVERY_TTL_MS);
  await sendMagicLink(c.env, {
    to: email,
    name: user.name,
    token,
    kind: "recovery",
  });

  return generic();
});
```

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: PASS (11 testes no arquivo, suíte inteira verde).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): POST /auth/recover com resposta sempre genérica

Email inexistente, documento errado, conta excluída e cooldown ativo
respondem todos 200 {ok:true}. O resultado real só aparece no email, que
só chega a quem já é dono da caixa.

Usuário sem documento cadastrado valida só o email — o checkout pode não
ter pedido CPF, e trancar cliente pagante fora seria pior.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: `lib/hotmartApi.ts` — cliente somente leitura

O módulo tem uma restrição que é o ponto inteiro dele: **não pode conter nada que escreva na Hotmart**. O cancelamento de assinatura (sub-projeto 4) vai num arquivo separado, para que o job que roda sozinho às 3h da manhã não alcance a função que cancela assinaturas.

**Files:**
- Create: `src/lib/hotmartApi.ts`
- Test: `test/hotmartApi.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces, de `src/lib/hotmartApi.ts`:
  - `interface HotmartSubscription { subscriberCode: string; email: string; name: string | null; status: string; productUcode: string | null; planName: string | null; dateNextCharge: number | null }`
  - `const RECONCILE_START_DATE_MS: number`
  - `fetchAccessToken(env: Env): Promise<string>`
  - `listSubscriptions(env: Env, accessToken: string): Promise<HotmartSubscription[]>`

- [ ] **Step 1: Escrever o teste que falha**

`test/hotmartApi.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as hotmartApi from "../src/lib/hotmartApi";
import {
  fetchAccessToken,
  listSubscriptions,
  RECONCILE_START_DATE_MS,
} from "../src/lib/hotmartApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function subscriptionItem(overrides: Record<string, unknown> = {}) {
  return {
    subscriber_code: "SUB-API-1",
    status: "ACTIVE",
    date_next_charge: Date.now() + 30 * 86400000,
    plan: { name: "Mensal", id: 99 },
    product: { id: 1234567, name: "Mais Aprovação", ucode: "UCODE_ASSINATURA" },
    subscriber: { name: "Aluno API", email: "api@test.com" },
    ...overrides,
  };
}

describe("INVARIANTE: hotmartApi é somente leitura", () => {
  it("não exporta nenhuma função de cancelamento", () => {
    const nomes = Object.keys(hotmartApi);
    const escrita = nomes.filter((n) => /cancel|delete|revoke|refund/i.test(n));

    expect(escrita).toEqual([]);
  });
});

describe("fetchAccessToken", () => {
  it("usa client_credentials com Basic auth", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "AT-123" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", spy);

    expect(await fetchAccessToken(env)).toBe("AT-123");

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(env.HOTMART_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Basic " + btoa("cid:csecret"));
    expect(String(init.body)).toContain("grant_type=client_credentials");
  });

  it("lança quando o token endpoint responde erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    await expect(fetchAccessToken(env)).rejects.toThrow();
  });
});

describe("listSubscriptions", () => {
  it("mapeia os campos do retorno", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [subscriptionItem()] }), {
            status: 200,
          }),
      ),
    );

    const [sub] = await listSubscriptions(env, "AT");

    expect(sub).toEqual({
      subscriberCode: "SUB-API-1",
      email: "api@test.com",
      name: "Aluno API",
      status: "ACTIVE",
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      dateNextCharge: expect.any(Number),
    });
  });

  it("passa start_date antigo e explícito", async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await listSubscriptions(env, "AT");

    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.searchParams.get("start_date")).toBe(
      String(RECONCILE_START_DATE_MS),
    );
    expect(RECONCILE_START_DATE_MS).toBeLessThan(Date.UTC(2021, 0, 1));
  });

  it("envia o Bearer token", async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await listSubscriptions(env, "AT-XYZ");

    expect(spy.mock.calls[0][1].headers.authorization).toBe("Bearer AT-XYZ");
  });

  it("percorre todas as páginas via next_page_token", async () => {
    let chamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamada++;
        if (chamada === 1) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem({ subscriber_code: "P1" })],
              page_info: { next_page_token: "TOKEN-P2" },
            }),
            { status: 200 },
          );
        }
        if (chamada === 2) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem({ subscriber_code: "P2" })],
              page_info: { next_page_token: "TOKEN-P3" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: [subscriptionItem({ subscriber_code: "P3" })],
            page_info: {},
          }),
          { status: 200 },
        );
      }),
    );

    const subs = await listSubscriptions(env, "AT");

    expect(subs.map((s) => s.subscriberCode)).toEqual(["P1", "P2", "P3"]);
    expect(chamada).toBe(3);
  });

  it("lança quando uma página falha — reconciliação parcial é perigosa", async () => {
    let chamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamada++;
        if (chamada === 1) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem()],
              page_info: { next_page_token: "TOKEN-P2" },
            }),
            { status: 200 },
          );
        }
        return new Response("erro", { status: 500 });
      }),
    );

    await expect(listSubscriptions(env, "AT")).rejects.toThrow();
  });

  it("tolera itens sem ucode ou sem date_next_charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                subscriptionItem({
                  product: { id: 1, name: "Sem ucode" },
                  date_next_charge: undefined,
                }),
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const [sub] = await listSubscriptions(env, "AT");
    expect(sub.productUcode).toBeNull();
    expect(sub.dateNextCharge).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/hotmartApi.test.ts
```

Esperado: FAIL — `src/lib/hotmartApi.ts` não existe.

- [ ] **Step 3: Criar `src/lib/hotmartApi.ts`**

```typescript
import type { Env } from "../config/env";

/**
 * ⚠️ MÓDULO SOMENTE LEITURA — não adicione nada que escreva na Hotmart.
 *
 * Com o cancelamento de assinatura em uso (exclusão de conta, sub-projeto 4),
 * HOTMART_CLIENT_SECRET é uma credencial destrutiva: quem a obtiver pode
 * cancelar toda a base de assinantes. A escrita mora em lib/hotmartCancel.ts,
 * alcançável só pelo caminho de exclusão iniciado pelo titular.
 *
 * O cron de reconciliação importa ESTE módulo. Um bug que o fizesse cancelar
 * assinaturas destruiria a receita do negócio numa única execução às 3h da
 * manhã. Há um teste que trava esta invariante.
 */

export interface HotmartSubscription {
  subscriberCode: string;
  email: string;
  name: string | null;
  status: string;
  productUcode: string | null;
  planName: string | null;
  /** Na assinatura cancelada, é a data do ÚLTIMO acesso pago. */
  dateNextCharge: number | null;
}

/**
 * O `start_date` da API tem default de *hoje − 30 dias* sobre a data de início
 * da assinatura. Sem passá-lo explicitamente com data antiga, toda assinatura
 * veterana parece inexistente — e a reconciliação acharia que a base sumiu.
 */
export const RECONCILE_START_DATE_MS = Date.UTC(2020, 0, 1);

const PAGE_SIZE = 50;

export async function fetchAccessToken(env: Env): Promise<string> {
  const basic = btoa(`${env.HOTMART_CLIENT_ID}:${env.HOTMART_CLIENT_SECRET}`);
  const res = await fetch(env.HOTMART_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.HOTMART_CLIENT_ID,
      client_secret: env.HOTMART_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`hotmart token falhou: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("hotmart token ausente na resposta");
  return data.access_token;
}

interface RawSubscription {
  subscriber_code?: string;
  status?: string;
  date_next_charge?: number;
  plan?: { name?: string };
  product?: { ucode?: string };
  subscriber?: { name?: string; email?: string };
}

interface RawPage {
  items?: RawSubscription[];
  page_info?: { next_page_token?: string };
}

/**
 * Lista TODAS as assinaturas da conta, percorrendo a paginação.
 *
 * Não filtra por produto na query: a API filtra por `product_id` (número de 7
 * dígitos), e o que guardamos dos webhooks é o `ucode`. Como o `ucode` vem na
 * resposta, o filtro é feito por quem chama. Evita mais um item de configuração
 * a confirmar.
 *
 * Qualquer página que falhe LANÇA. Uma listagem parcial faria a reconciliação
 * concluir que assinaturas sumiram.
 */
export async function listSubscriptions(
  env: Env,
  accessToken: string,
): Promise<HotmartSubscription[]> {
  const out: HotmartSubscription[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "/payments/api/v1/subscriptions",
      env.HOTMART_API_BASE_URL,
    );
    url.searchParams.set("max_results", String(PAGE_SIZE));
    url.searchParams.set("start_date", String(RECONCILE_START_DATE_MS));
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`hotmart subscriptions falhou: ${res.status}`);
    }

    const page = (await res.json()) as RawPage;
    for (const item of page.items ?? []) {
      if (!item.subscriber_code || !item.subscriber?.email) continue;
      out.push({
        subscriberCode: item.subscriber_code,
        email: item.subscriber.email,
        name: item.subscriber.name ?? null,
        status: item.status ?? "UNKNOWN",
        productUcode: item.product?.ucode ?? null,
        planName: item.plan?.name ?? null,
        dateNextCharge: item.date_next_charge ?? null,
      });
    }

    pageToken = page.page_info?.next_page_token;
  } while (pageToken);

  return out;
}
```

> O caminho `/payments/api/v1/subscriptions` **não foi confirmado** — a documentação da API de dados é renderizada via JS e o sitemap do site está bloqueado. Confirmar na Task 17. Se o caminho for outro, é o único ponto a alterar (o host já é variável).

- [ ] **Step 4: Rodar os testes**

```bash
cd api && npx vitest run test/hotmartApi.test.ts && npm run typecheck
```

Esperado: PASS (9 testes). O primeiro é a invariante de somente-leitura.

- [ ] **Step 5: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): cliente somente leitura da API de dados Hotmart

client_credentials com Basic auth e listagem paginada. start_date antigo
e explícito: o default da API é hoje-30d e esconderia toda assinatura
veterana.

Página que falha lança em vez de devolver lista parcial — reconciliação
sobre listagem incompleta concluiria que assinaturas sumiram.

Módulo é somente leitura por decisão de segurança, com teste travando a
invariante: o cron não pode alcançar cancelamento de assinatura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: `jobs/reconcile.ts` — o cron diário

A regra central: **ausência nunca revoga**. Um filtro errado ou uma página perdida revogaria a base inteira, e é por isso que a única forma de revogar aqui é a API dizer explicitamente que a assinatura acabou.

**Files:**
- Create: `src/jobs/reconcile.ts`
- Modify: `src/index.ts`
- Test: `test/reconcile.test.ts`

**Interfaces:**
- Consumes: `fetchAccessToken`, `listSubscriptions`, `HotmartSubscription` (Task 15); `upsertUserFromPurchase`, `findUserByEmail` (Task 4); `findSubscriptionByCode`, `upsertSubscription`, `setAccessUntil`, `revokeAccess`, `listSubscriptionCodes` (Task 5); `createToken`, `hasPendingToken`, `FIRST_ACCESS_TTL_MS` (Task 6); `isDeleted` (Task 7); `sendMagicLink` (Task 8).
- Produces: `interface ReconcileStats { created: number; corrected: number; revoked: number; skipped: number; missingInApi: number }`, `reconcile(env: Env): Promise<ReconcileStats>`.

- [ ] **Step 1: Escrever o teste que falha**

`test/reconcile.test.ts`:

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { getDb } from "../src/db/client";
import { reconcile } from "../src/jobs/reconcile";
import { upsertUserFromPurchase, findUserByEmail } from "../src/db/users";
import {
  upsertSubscription,
  findSubscriptionByCode,
} from "../src/db/subscriptions";
import { markDeleted } from "../src/db/deletedAccounts";
import { hmacHex } from "../src/lib/hmac";
import { fakeEmailSender, envWith } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

function apiItem(overrides: Record<string, unknown> = {}) {
  return {
    subscriber_code: "SUB-REC-1",
    status: "ACTIVE",
    date_next_charge: Date.now() + 30 * 86400000,
    plan: { name: "Mensal" },
    product: { ucode: "UCODE_ASSINATURA" },
    subscriber: { name: "Aluno Rec", email: "rec-api@test.com" },
    ...overrides,
  };
}

/** Stub do token + de uma única página de assinaturas. */
function stubHotmart(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === env.HOTMART_TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: "AT" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ items }), { status: 200 });
    }),
  );
}

async function assinaturaNoBanco(
  email: string,
  code: string,
  accessUntil: Date | null,
  status = "ACTIVE",
) {
  const userId = await upsertUserFromPurchase(
    db(),
    { email, name: "Aluno", documentHash: null },
    [],
  );
  await upsertSubscription(db(), {
    subscriberCode: code,
    userId,
    productUcode: "UCODE_ASSINATURA",
    planName: "Mensal",
    status,
    accessUntil,
    lastTransaction: null,
  });
  return userId;
}

describe("reconcile — webhook de compra perdido", () => {
  it("cria o usuário ausente e envia o link mágico", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-NOVO",
        subscriber: { name: "Perdido", email: "perdido@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const user = await findUserByEmail(db(), "perdido@test.com");
    expect(user).toBeDefined();
    expect(user?.name).toBe("Perdido");
    expect(user?.documentHash).toBeNull(); // a API não devolve documento

    const sub = await findSubscriptionByCode(db(), "SUB-REC-NOVO");
    expect(sub?.userId).toBe(user!.id);

    expect(sent).toHaveLength(1);
    expect(stats.created).toBe(1);
  });

  it("não reenvia link se já existe token pendente", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-PEND",
        subscriber: { name: null, email: "pendente-rec@test.com" },
      }),
    ]);

    const primeira = fakeEmailSender();
    await reconcile(envWith({ EMAIL: primeira.sender }));
    expect(primeira.sent).toHaveLength(1);

    // a assinatura agora existe, então este caso vira "corrected"; o teste
    // garante que nenhum segundo email sai
    const segunda = fakeEmailSender();
    await reconcile(envWith({ EMAIL: segunda.sender }));
    expect(segunda.sent).toHaveLength(0);
  });
});

describe("reconcile — correção de datas", () => {
  it("corrige access_until divergente", async () => {
    const correto = Date.now() + 45 * 86400000;
    await assinaturaNoBanco(
      "corrige@test.com",
      "SUB-REC-CORR",
      new Date(Date.now() + 7 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-CORR",
        date_next_charge: correto,
        subscriber: { name: "Aluno", email: "corrige@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-CORR");
    expect(sub?.accessUntil?.getTime()).toBe(correto);
    expect(stats.corrected).toBe(1);
  });

  it("não conta correção quando a data já está certa", async () => {
    const data = Date.now() + 20 * 86400000;
    await assinaturaNoBanco("igual@test.com", "SUB-REC-IGUAL", new Date(data));
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-IGUAL",
        date_next_charge: data,
        subscriber: { name: "Aluno", email: "igual@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    expect((await reconcile(envWith({ EMAIL: sender }))).corrected).toBe(0);
  });

  it("cancelada com data futura mantém acesso até o fim do ciclo pago", async () => {
    const fimDoCiclo = Date.now() + 12 * 86400000;
    await assinaturaNoBanco(
      "cancel-rec@test.com",
      "SUB-REC-CANC",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-CANC",
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: fimDoCiclo,
        subscriber: { name: "Aluno", email: "cancel-rec@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-CANC");
    expect(sub?.accessUntil?.getTime()).toBe(fimDoCiclo);
  });
});

describe("reconcile — revogação", () => {
  it("revoga quando a data já passou", async () => {
    await assinaturaNoBanco(
      "revoga@test.com",
      "SUB-REC-REV",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-REV",
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: Date.now() - 86400000,
        subscriber: { name: "Aluno", email: "revoga@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-REV");
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(stats.revoked).toBe(1);
  });

  it("revoga status não-ativo sem data", async () => {
    await assinaturaNoBanco(
      "inativo@test.com",
      "SUB-REC-INAT",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-INAT",
        status: "INACTIVE",
        date_next_charge: undefined,
        subscriber: { name: "Aluno", email: "inativo@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-INAT");
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("reconcile — REGRA DURA: ausência nunca revoga", () => {
  it("assinatura no D1 e ausente na API permanece intocada", async () => {
    const acesso = new Date(Date.now() + 40 * 86400000);
    await assinaturaNoBanco("fantasma@test.com", "SUB-REC-AUSENTE", acesso);

    stubHotmart([]); // a API não devolve nada
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-AUSENTE");
    expect(sub?.accessUntil?.getTime()).toBe(acesso.getTime());
    expect(sub?.status).toBe("ACTIVE");
    expect(stats.revoked).toBe(0);
    expect(stats.missingInApi).toBeGreaterThan(0);
  });

  it("propaga o erro quando a API falha, sem tocar em nada", async () => {
    const acesso = new Date(Date.now() + 40 * 86400000);
    await assinaturaNoBanco("erro-api@test.com", "SUB-REC-ERRO", acesso);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === env.HOTMART_TOKEN_URL) {
          return new Response(JSON.stringify({ access_token: "AT" }));
        }
        return new Response("boom", { status: 500 });
      }),
    );
    const { sender } = fakeEmailSender();

    await expect(reconcile(envWith({ EMAIL: sender }))).rejects.toThrow();

    const sub = await findSubscriptionByCode(db(), "SUB-REC-ERRO");
    expect(sub?.accessUntil?.getTime()).toBe(acesso.getTime());
  });
});

describe("reconcile — filtros", () => {
  it("ignora assinatura de produto fora dos ucodes configurados", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-OUTRO",
        product: { ucode: "UCODE_DE_OUTRO_PRODUTO" },
        subscriber: { name: "Outro", email: "outro-produto@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    expect(await findUserByEmail(db(), "outro-produto@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("pula email na tombstone e NÃO recria a conta excluída", async () => {
    await markDeleted(
      db(),
      await hmacHex("excluido-rec@test.com", env.DOCUMENT_HMAC_KEY),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-TOMB",
        // assinatura cancelada continua listada com data futura — é
        // exatamente o caso que desfaria a exclusão sem a tombstone
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: Date.now() + 20 * 86400000,
        subscriber: { name: "Excluído", email: "excluido-rec@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    expect(await findUserByEmail(db(), "excluido-rec@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(stats.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd api && npx vitest run test/reconcile.test.ts
```

Esperado: FAIL — `src/jobs/reconcile.ts` não existe.

- [ ] **Step 3: Criar `src/jobs/reconcile.ts`**

```typescript
import type { Env } from "../config/env";
import { getSubscriptionUcodes, getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { upsertUserFromPurchase, findUserByEmail } from "../db/users";
import {
  findSubscriptionByCode,
  upsertSubscription,
  setAccessUntil,
  revokeAccess,
  listSubscriptionCodes,
} from "../db/subscriptions";
import {
  createToken,
  hasPendingToken,
  FIRST_ACCESS_TTL_MS,
} from "../db/authTokens";
import { isDeleted } from "../db/deletedAccounts";
import { sendMagicLink } from "../lib/email";
import { normalizeEmail, hmacHex } from "../lib/hmac";
import {
  fetchAccessToken,
  listSubscriptions,
  type HotmartSubscription,
} from "../lib/hotmartApi";

export interface ReconcileStats {
  created: number;
  corrected: number;
  revoked: number;
  skipped: number;
  missingInApi: number;
}

const ACTIVE_STATUSES = new Set(["ACTIVE", "STARTED", "DELAYED", "OVERDUE"]);

/**
 * Reconciliação diária contra a API de dados da Hotmart.
 *
 * Fecha os dois furos que o webhook deixa quando uma entrega falha:
 * - compra perdida: aluno pagou e não existe no sistema. É o ÚNICO remédio
 *   automático — o recover não ajuda quem não existe.
 * - cancelamento perdido: ex-assinante com acesso pago indefinidamente.
 *
 * REGRA DURA: ausência na listagem NUNCA revoga. Só revoga quando a API
 * retorna explicitamente a assinatura com status não-ativo ou data no passado.
 * Um filtro errado ou uma página perdida revogaria a base inteira.
 */
export async function reconcile(env: Env): Promise<ReconcileStats> {
  const db = getDb(env);
  const stats: ReconcileStats = {
    created: 0,
    corrected: 0,
    revoked: 0,
    skipped: 0,
    missingInApi: 0,
  };

  // Se qualquer página falhar, listSubscriptions lança e nada é tocado.
  const token = await fetchAccessToken(env);
  const remote = await listSubscriptions(env, token);

  const ucodes = getSubscriptionUcodes(env);
  const seen = new Set<string>();

  for (const sub of remote) {
    if (!sub.productUcode || !ucodes.includes(sub.productUcode)) continue;
    seen.add(sub.subscriberCode);

    const email = normalizeEmail(sub.email);
    const emailHash = await hmacHex(email, env.DOCUMENT_HMAC_KEY);

    // A conta excluída pelo titular não volta pelo cron. Assinatura cancelada
    // continua listada com date_next_charge no futuro — sem esta guarda, a
    // exclusão se desfaria na madrugada seguinte.
    if (await isDeleted(db, emailHash)) {
      stats.skipped++;
      continue;
    }

    const existing = await findSubscriptionByCode(db, sub.subscriberCode);
    if (!existing) {
      await provision(env, sub, email);
      stats.created++;
      continue;
    }

    const applied = await applyRemoteState(env, sub, existing.accessUntil);
    if (applied === "revoked") stats.revoked++;
    if (applied === "corrected") stats.corrected++;
  }

  const local = await listSubscriptionCodes(db);
  stats.missingInApi = local.filter((code) => !seen.has(code)).length;

  return stats;
}

/** Webhook de compra perdido: cria a conta e manda o link. */
async function provision(
  env: Env,
  sub: HotmartSubscription,
  email: string,
): Promise<void> {
  const db = getDb(env);

  // A API de dados não devolve o documento do assinante, então o usuário nasce
  // com documentHash nulo — o recover dele valida só o email.
  const userId = await upsertUserFromPurchase(
    db,
    { email, name: sub.name, documentHash: null },
    getAdminEmails(env),
  );

  await upsertSubscription(db, {
    subscriberCode: sub.subscriberCode,
    userId,
    productUcode: sub.productUcode!,
    planName: sub.planName,
    status: sub.status,
    accessUntil: sub.dateNextCharge ? new Date(sub.dateNextCharge) : null,
    lastTransaction: null,
  });

  const user = await findUserByEmail(db, email);
  if (user?.passwordHash == null && !(await hasPendingToken(db, userId))) {
    const token = await createToken(db, userId, FIRST_ACCESS_TTL_MS);
    await sendMagicLink(env, {
      to: email,
      name: sub.name,
      token,
      kind: "first_access",
    });
  }
}

type Applied = "revoked" | "corrected" | "unchanged";

/**
 * `date_next_charge` é a verdade em qualquer status: numa assinatura cancelada
 * ele é a data do último acesso pago. Por isso a data manda, e o status só
 * decide o que fazer quando ela não vem.
 */
async function applyRemoteState(
  env: Env,
  sub: HotmartSubscription,
  currentAccessUntil: Date | null,
): Promise<Applied> {
  const db = getDb(env);

  if (sub.dateNextCharge) {
    if (sub.dateNextCharge <= Date.now()) {
      await revokeAccess(db, sub.subscriberCode, sub.status);
      return "revoked";
    }
    if (currentAccessUntil?.getTime() !== sub.dateNextCharge) {
      await setAccessUntil(db, sub.subscriberCode, new Date(sub.dateNextCharge));
      return "corrected";
    }
    return "unchanged";
  }

  if (!ACTIVE_STATUSES.has(sub.status)) {
    await revokeAccess(db, sub.subscriberCode, sub.status);
    return "revoked";
  }

  return "unchanged";
}
```

- [ ] **Step 4: Ligar o cron em `src/index.ts`**

```typescript
import app from "./app";
import type { Env } from "./config/env";
import { reconcile } from "./jobs/reconcile";

export default {
  fetch: app.fetch,

  /** Cron `0 3 * * *` (00:00 BRT) — ver wrangler.jsonc. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const stats = await reconcile(env);
    console.log("reconcile", stats);
  },
};
```

- [ ] **Step 5: Rodar os testes**

```bash
cd api && npm test && npm run typecheck
```

Esperado: PASS (11 testes no arquivo, suíte inteira verde).

- [ ] **Step 6: Commit**

```bash
cd api && git add -A . && git commit -m "feat(api): cron diário de reconciliação

Fecha os dois furos do webhook: compra perdida (aluno pagou e não existe
— único remédio automático, já que o recover não ajuda quem não existe) e
cancelamento perdido (acesso pago indefinido).

REGRA DURA: ausência na listagem nunca revoga. Só revoga com retorno
explícito de status não-ativo ou data no passado — filtro errado ou
página perdida revogaria a base inteira.

Pula email na tombstone: assinatura cancelada segue listada com data
futura e recriaria a conta excluída na madrugada seguinte.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Runbook de verificação manual

Os testes rodam contra fixtures derivados da documentação, não de tráfego real. Este runbook é onde as suposições encostam na Hotmart de verdade — e é a única tarefa que pode invalidar decisões das anteriores.

**Files:**
- Create: `docs/runbook-verificacao-hotmart.md`
- Modify: `api/README.md`

**Interfaces:**
- Consumes: tudo.
- Produces: nada em código.

- [ ] **Step 1: Escrever `docs/runbook-verificacao-hotmart.md`**

````markdown
# Runbook — verificação manual contra o sandbox da Hotmart

> A suíte automatizada usa fixtures **derivados da documentação**, não de
> tráfego real, e dois valores de configuração não puderam ser confirmados.
> Este roteiro é o que fecha essa lacuna. Rodar antes de considerar a Fundação
> pronta.

## Pré-requisitos

| Item | Onde obter |
|---|---|
| Conta sandbox Hotmart com produto de assinatura | painel Hotmart |
| `hottok` | painel → Ferramentas → Webhook |
| `client_id` / `client_secret` (API de dados) | painel → Ferramentas → Credenciais |
| `ucode` do produto | painel do produto |
| Domínio de envio verificado (SPF/DKIM) | dashboard Cloudflare → Email |
| Chaves Turnstile | dashboard Cloudflare → Turnstile |

## 1. Confirmar o endpoint da API de dados

**Esta é a lacuna conhecida.** O host e o caminho em `HOTMART_API_BASE_URL` /
`HOTMART_TOKEN_URL` e a rota `/payments/api/v1/subscriptions` em
`src/lib/hotmartApi.ts` foram inferidos, não confirmados.

```bash
# obter token
curl -s -X POST "$HOTMART_TOKEN_URL" \
  -H "Authorization: Basic $(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"

# listar assinaturas
curl -s "https://sandbox.hotmart.com/payments/api/v1/subscriptions?max_results=50&start_date=1577836800000" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 2000
```

- [ ] Token obtido. Se o `HOTMART_TOKEN_URL` estiver errado, corrigir em `wrangler.jsonc`.
- [ ] Listagem retorna itens. Se o caminho estiver errado, corrigir em `src/lib/hotmartApi.ts` e ajustar `test/hotmartApi.test.ts`.
- [ ] Conferir que o item traz `subscriber.email`, `subscriber_code`, `status`, `product.ucode` e `date_next_charge`. **Se `product.ucode` não vier, o filtro do cron não funciona** — nesse caso passar a filtrar por `product_id` e adicionar a variável correspondente.
- [ ] Conferir o formato da paginação (`page_info.next_page_token`).

## 2. Conferir os fixtures contra um evento real

- [ ] Apontar o webhook do sandbox para um coletor (`webhook.site` ou similar).
- [ ] Fazer uma compra de teste no sandbox.
- [ ] Salvar o JSON recebido.
- [ ] Comparar campo a campo com `api/test/fixtures/hotmart.ts`:
  - `data.product.ucode`
  - `data.buyer.email` / `.name` / `.document`
  - `data.purchase.transaction` / `.date_next_charge` / `.recurrence_number`
  - `data.subscription.subscriber.code` / `.plan.name` / `.status`
- [ ] Ajustar os fixtures onde divergirem e rodar `npm test`.

> Divergência aqui é o risco mais provável do plano: os testes podem estar
> verdes contra um payload que a Hotmart não envia.

## 3. Fluxo ponta a ponta

- [ ] Apontar o webhook do sandbox para o Worker publicado.
- [ ] Compra de teste → `PURCHASE_APPROVED` chega e responde 200.
- [ ] `users` tem o aluno, com `document_hash` preenchido e `password_hash` nulo.
- [ ] `subscriptions` tem a linha com `access_until` = `date_next_charge`.
- [ ] **O email chegou** (checar também spam).
- [ ] Abrir o link → `POST /auth/set-password` → responde 200 e seta cookie.
- [ ] `GET /auth/me` → `tier: "assinante"`.
- [ ] Reusar o mesmo link → 400.
- [ ] `POST /auth/login` com a senha → 200.
- [ ] `POST /auth/login` com senha errada → 401 `invalid_credentials`.
- [ ] `POST /auth/login` com email inexistente → **resposta idêntica**.

## 4. Recuperação

- [ ] `POST /auth/recover` com email e CPF corretos → 200, email chega.
- [ ] Repetir em menos de 5 min → 200, **sem segundo email**.
- [ ] CPF errado → 200, sem email.
- [ ] Email inexistente → 200, sem email.

## 5. Cancelamento

- [ ] Cancelar a assinatura no painel do sandbox.
- [ ] `SUBSCRIPTION_CANCELLATION` chega e responde 200.
- [ ] `access_until` = `date_next_charge` do payload (**não** a data de hoje).
- [ ] `GET /auth/me` ainda diz `assinante` (o ciclo pago não acabou).
- [ ] Confirmar que o payload realmente **não traz** `product.ucode`.

## 6. Idempotência

- [ ] Reenviar o mesmo evento (mesmo `id`) → 200 com `duplicate: true`.
- [ ] Nenhuma linha duplicada em `subscriptions`; nenhum segundo email.

## 7. Reconciliação

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

- [ ] Apagar manualmente uma linha de `subscriptions` cujo assinante está ativo no sandbox.
- [ ] Rodar o cron → a linha é recriada e o link mágico é enviado.
- [ ] Rodar de novo → nenhum email novo (guarda de token pendente).
- [ ] Criar no D1 uma assinatura com código inexistente na Hotmart → rodar o cron → **ela continua intocada** (`missingInApi` > 0, `revoked` = 0).

## 8. Turnstile e segredos

- [ ] `POST /auth/login` sem `turnstileToken` → 403.
- [ ] Com as chaves de teste "sempre falha" da Cloudflare → 403.
- [ ] `wrangler secret list` mostra os seis segredos.
- [ ] Nenhum segredo aparece em `wrangler.jsonc`.

## 9. LGPD

- [ ] Nos logs do Worker, **nenhum CPF, endereço ou telefone**.
- [ ] `SELECT * FROM users` não tem documento legível.
- [ ] `webhook_events` não guarda payload.

## Pendências que este runbook pode gerar

| Se acontecer | Ação |
|---|---|
| Caminho da API diferente | corrigir `src/lib/hotmartApi.ts` + teste |
| `product.ucode` ausente na listagem | passar a filtrar por `product_id`, nova variável |
| Fixtures divergentes | corrigir `test/fixtures/hotmart.ts` |
| Email não chega | conferir SPF/DKIM e a cota diária (conta nova tem limite conservador) |
| `send_email` incompatível com o vitest-pool-workers | contorno documentado em `vitest.config.ts` |
````

- [ ] **Step 2: Registrar o runbook no `api/README.md`**

Adicionar ao final:

```markdown
## Verificação manual

A suíte automatizada usa fixtures derivados da documentação da Hotmart, não de
tráfego real. Antes de considerar a Fundação pronta, rodar
[`docs/runbook-verificacao-hotmart.md`](../docs/runbook-verificacao-hotmart.md)
contra o sandbox.

Dois valores estão marcados como **não confirmados** e são o primeiro item do
runbook: o caminho da API de dados (`src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL` (`wrangler.jsonc`).
```

- [ ] **Step 3: Rodar a suíte completa uma última vez**

```bash
cd api && npm test && npm run typecheck
```

Esperado: toda a suíte verde.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: runbook de verificação manual contra o sandbox Hotmart

Os testes rodam contra fixtures derivados da documentação, não de
tráfego real. O runbook fecha essa lacuna e começa pelo item mais
arriscado: confirmar o caminho da API de dados e o token URL, que foram
inferidos porque a doc é renderizada via JS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cobertura da spec

| Requisito da spec | Tarefa |
|---|---|
| Remoção do OAuth (cliente, rotas, state cookie, `hotmart_user_id`) | 1 |
| `Env` nova, bindings, cron trigger, vars | 1 |
| 5 tabelas + convenção de cascata | 2 |
| PBKDF2, HMAC com pepper, token opaco, comparação constante | 3 |
| `loadEntitlement` / tier por `access_until` | 4 |
| `Subscription` 1:N com PK em `subscriber_code` | 2, 5 |
| Token de uso único, TTLs distintos, cooldown, invalidação | 6 |
| Idempotência com reprocesso de `received` | 7, 9 |
| Tombstone e suas três regras | 7, 10, 14, 16 |
| Email Sending e Turnstile server-side | 8 |
| hottok em tempo constante, Zod tolerante, minimização LGPD | 9 |
| `PURCHASE_APPROVED` provisiona + link mágico | 10 |
| Fallback de `date_next_charge` | 10 |
| Revogação, carência e cancelamento por `subscriber_code` | 11 |
| `POST /auth/set-password` | 12 |
| `POST /auth/login`, `/auth/me`, `/auth/logout` | 13 |
| `POST /auth/recover` com resposta genérica | 14 |
| Cliente somente leitura + invariante testada | 15 |
| Cron, `start_date` explícito, ausência nunca revoga | 16 |
| Runbook e conferência de fixtures | 17 |

**Fora do escopo desta fase** (sub-projeto 4, conforme a spec): `DELETE /auth/me`, `lib/hotmartCancel.ts`, telas de frontend, widget Turnstile.
