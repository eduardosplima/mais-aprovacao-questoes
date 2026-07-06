# Fundação — Auth, Sessão e Base de Dados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um Cloudflare Worker (Hono) em `api/` que autentica via Hotmart OAuth 2.0, emite sessão JWT em cookie, aplica RBAC relendo entitlement do D1, com migrações de `User`/`Subscription`.

**Architecture:** Worker stateless: sessão é um JWT (jose/HS256) em cookie HttpOnly; a identidade vai no `sub`, e `role`/tier são relidos do D1 a cada request via `loadEntitlement`. O `state` do OAuth vive num cookie assinado de curta duração (sem KV). O acesso à Hotmart passa por um `HotmartClient` injetável, mockável por `fetchMock` nos testes. Sem frontend, sem KV, sem CI.

**Tech Stack:** TypeScript, Hono 4, Drizzle ORM 0.45 + drizzle-kit 0.31 (D1/SQLite), jose 6 (JWT), Zod 4, Wrangler 4, Vitest 4 + `@cloudflare/vitest-pool-workers` 0.18 (Miniflare + D1 local).

## Global Constraints

- Todo o código roda no runtime **workerd** — apenas APIs edge/Web (Web Crypto, `fetch`, `crypto.randomUUID`); **nenhuma API de Node** (`fs`, `crypto` de node, `Buffer`).
- Versões (pinar em `package.json`, sem `^`): `hono@4.12.28`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `zod@4.4.3`, `jose@6.2.3`, `wrangler@4.107.0`, `vitest@4.1.10`, `@cloudflare/vitest-pool-workers@0.18.0`, `@cloudflare/workers-types@5.20260706.1`.
- Cookies **sempre** `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Segredos **nunca** em código nem no repositório — via `wrangler secret` (prod) e bindings do Miniflare (testes).
- Banco: **apenas** queries via Drizzle (parametrizadas); sem interpolação de string em SQL.
- Todo diretório de trabalho é `api/`. Comandos `npm`/`npx`/`wrangler` rodam de dentro de `api/`.
- Nomes de tabela: `users`, `subscriptions`. Coluna `status` guarda estado da assinatura (placeholder `'none'` na Fundação), **nunca** o tier.

---

## File Structure

Tudo dentro de `api/`:

- `package.json`, `tsconfig.json`, `wrangler.jsonc`, `drizzle.config.ts`, `vitest.config.ts` — toolchain.
- `worker-env.d.ts` — tipos de `cloudflare:test`.
- `src/index.ts` — app Hono, monta rotas, `/health`.
- `src/config/env.ts` — tipo `Env` + `getAdminEmails`.
- `src/db/schema.ts` — tabelas `users`, `subscriptions`.
- `src/db/client.ts` — `getDb(env)`.
- `src/db/users.ts` — `upsertUser`, `ensureSubscription`, `loadEntitlement`.
- `src/lib/jwt.ts` — `signSession`, `verifySession`.
- `src/lib/cookies.ts` — cookies de sessão e de state.
- `src/lib/hotmart.ts` — `HotmartClient` + `createHotmartClient`.
- `src/middleware/session.ts` — `requireSession`.
- `src/middleware/rbac.ts` — `requireAdmin`.
- `src/routes/auth.ts` — `/auth/login|callback|me|logout`.
- `migrations/` — SQL gerado pelo drizzle-kit.
- `test/**` — testes Vitest + `test/apply-migrations.ts`.

---

## Task 1: Toolchain — scaffold do Worker + `/health` + Vitest

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/wrangler.jsonc`, `api/vitest.config.ts`, `api/worker-env.d.ts`
- Create: `api/src/config/env.ts`, `api/src/index.ts`
- Test: `api/test/health.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `Env` (interface) em `src/config/env.ts` com: `DB: D1Database`, `JWT_SECRET: string`, `COOKIE_SIGNING_KEY: string`, `ADMIN_EMAILS: string`, `HOTMART_CLIENT_ID: string`, `HOTMART_CLIENT_SECRET: string`, `HOTMART_REDIRECT_URI: string`, `HOTMART_AUTHORIZE_URL: string`, `HOTMART_TOKEN_URL: string`, `HOTMART_USERINFO_URL: string`.
  - `getAdminEmails(env: Env): string[]`.
  - `app` (default export de `src/index.ts`): `Hono<{ Bindings: Env }>`, com `GET /health` → `{ ok: true }`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "mais-aprovacao-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply mais-aprovacao-db --local"
  },
  "dependencies": {
    "hono": "4.12.28",
    "drizzle-orm": "0.45.2",
    "jose": "6.2.3",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.18.0",
    "@cloudflare/workers-types": "5.20260706.1",
    "drizzle-kit": "0.31.10",
    "vitest": "4.1.10",
    "wrangler": "4.107.0"
  }
}
```

Run: `cd api && npm install`

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src", "test", "worker-env.d.ts", "*.config.ts"]
}
```

- [ ] **Step 3: `wrangler.jsonc`**

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
  ]
}
```

- [ ] **Step 4: `worker-env.d.ts`**

```ts
/// <reference types="@cloudflare/vitest-pool-workers" />
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "./src/config/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 5: `src/config/env.ts`**

```ts
import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  COOKIE_SIGNING_KEY: string;
  ADMIN_EMAILS: string;
  HOTMART_CLIENT_ID: string;
  HOTMART_CLIENT_SECRET: string;
  HOTMART_REDIRECT_URI: string;
  HOTMART_AUTHORIZE_URL: string;
  HOTMART_TOKEN_URL: string;
  HOTMART_USERINFO_URL: string;
}

export function getAdminEmails(env: Env): string[] {
  return env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
```

- [ ] **Step 6: `vitest.config.ts`** (bindings de teste incluem já todos os secrets que as tarefas seguintes usam)

```ts
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations("./migrations");

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: "test-jwt-secret",
            COOKIE_SIGNING_KEY: "test-cookie-key",
            ADMIN_EMAILS: "admin@test.com",
            HOTMART_CLIENT_ID: "cid",
            HOTMART_CLIENT_SECRET: "csecret",
            HOTMART_REDIRECT_URI: "https://app.test/auth/callback",
            HOTMART_AUTHORIZE_URL: "https://hotmart.test/authorize",
            HOTMART_TOKEN_URL: "https://hotmart.test/token",
            HOTMART_USERINFO_URL: "https://hotmart.test/userinfo",
          },
        },
      },
    },
  },
});
```

- [ ] **Step 7: `test/apply-migrations.ts`** (setup — cria dir vazio ok; migrações reais chegam na Task 2)

```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Também crie o diretório vazio: `mkdir -p api/migrations && touch api/migrations/.gitkeep` (para `readD1Migrations` não falhar; retorna `[]`).

- [ ] **Step 8: Escreva o teste que falha — `test/health.test.ts`**

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("responde ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 9: Rode e veja falhar**

Run: `cd api && npx vitest run test/health.test.ts`
Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 10: `src/index.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

export default app;
```

> Nota: `./routes/auth` só existe a partir da Task 8. Até lá, **remova temporariamente** as duas linhas de `auth` (o `import` e o `app.route`) para o Worker compilar; a Task 8 as reintroduz. Comece agora só com `/health`.

Versão inicial (Task 1) de `src/index.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "./config/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));

export default app;
```

- [ ] **Step 11: Rode e veja passar**

Run: `cd api && npx vitest run test/health.test.ts`
Expected: PASS (1 test).

- [ ] **Step 12: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): scaffold do Worker Hono + /health + Vitest pool-workers"
```

---

## Task 2: Schema e migrações (`users`, `subscriptions`)

**Files:**
- Create: `api/drizzle.config.ts`, `api/src/db/schema.ts`, `api/src/db/client.ts`
- Create: `api/migrations/0000_*.sql` (gerado)
- Test: `api/test/db.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 1).
- Produces:
  - `users`, `subscriptions` (tabelas Drizzle) em `src/db/schema.ts`.
  - `getDb(env: Env)` e tipo `Db = ReturnType<typeof getDb>` em `src/db/client.ts`.

- [ ] **Step 1: `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
```

- [ ] **Step 2: `src/db/schema.ts`**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hotmartUserId: text("hotmart_user_id").unique(),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  hotmartSubscriberCode: text("hotmart_subscriber_code"),
  plan: text("plan"),
  status: text("status").notNull().default("none"),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
});
```

- [ ] **Step 3: `src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Env } from "../config/env";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
```

- [ ] **Step 4: Gere a migração**

Run: `cd api && rm -f migrations/.gitkeep && npx drizzle-kit generate`
Expected: cria `migrations/0000_<nome>.sql` com `CREATE TABLE users ...` e `CREATE TABLE subscriptions ...`, além de `migrations/meta/`.

- [ ] **Step 5: Escreva o teste que falha — `test/db.test.ts`**

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";

describe("schema + migrations", () => {
  it("insere e lê um usuário", async () => {
    const db = getDb(env);
    const id = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id, email: "a@a.com", role: "user", createdAt: new Date() })
      .run();
    const row = await db.select().from(users).where(eq(users.id, id)).get();
    expect(row?.email).toBe("a@a.com");
    expect(row?.role).toBe("user");
  });
});
```

- [ ] **Step 6: Rode e veja passar** (as migrações são aplicadas pelo setup `apply-migrations.ts`, que agora lê o SQL gerado)

Run: `cd api && npx vitest run test/db.test.ts`
Expected: PASS.

- [ ] **Step 7: Aplique também no D1 local (sanidade)**

Run: `cd api && npx wrangler d1 migrations apply mais-aprovacao-db --local`
Expected: aplica `0000_*.sql` sem erro.

- [ ] **Step 8: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): schema e migrações de users/subscriptions (Drizzle/D1)"
```

---

## Task 3: Repositório de usuários — `upsertUser`, `ensureSubscription`, `loadEntitlement`

**Files:**
- Create: `api/src/db/users.ts`
- Test: `api/test/users.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `users`/`subscriptions` (Task 2).
- Produces (em `src/db/users.ts`):
  - `type Tier = "assinante" | "gratuito"`
  - `interface HotmartIdentity { hotmartUserId: string; email: string }`
  - `interface Entitlement { userId: string; email: string; role: "admin" | "user"; tier: Tier }`
  - `upsertUser(db: Db, identity: HotmartIdentity, adminEmails: string[]): Promise<string>` (retorna userId)
  - `ensureSubscription(db: Db, userId: string): Promise<void>`
  - `loadEntitlement(db: Db, userId: string): Promise<Entitlement | null>`

- [ ] **Step 1: Escreva os testes que falham — `test/users.test.ts`**

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import {
  upsertUser,
  ensureSubscription,
  loadEntitlement,
} from "../src/db/users";

const admins = ["admin@test.com"];

describe("users repo", () => {
  it("cria usuário comum e deriva tier gratuito", async () => {
    const db = getDb(env);
    const id = await upsertUser(
      db,
      { hotmartUserId: "h1", email: "user1@test.com" },
      admins,
    );
    await ensureSubscription(db, id);
    const ent = await loadEntitlement(db, id);
    expect(ent).toEqual({
      userId: id,
      email: "user1@test.com",
      role: "user",
      tier: "gratuito",
    });
  });

  it("concede role admin via allowlist (case-insensitive)", async () => {
    const db = getDb(env);
    const id = await upsertUser(
      db,
      { hotmartUserId: "h2", email: "Admin@Test.com" },
      admins,
    );
    const ent = await loadEntitlement(db, id);
    expect(ent?.role).toBe("admin");
  });

  it("upsert é idempotente pelo e-mail e atualiza hotmartUserId", async () => {
    const db = getDb(env);
    const first = await upsertUser(
      db,
      { hotmartUserId: "h3", email: "dup@test.com" },
      admins,
    );
    const second = await upsertUser(
      db,
      { hotmartUserId: "h3-new", email: "dup@test.com" },
      admins,
    );
    expect(second).toBe(first);
  });

  it("loadEntitlement retorna null para id inexistente", async () => {
    const db = getDb(env);
    expect(await loadEntitlement(db, "nao-existe")).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/users.test.ts`
Expected: FAIL — `Cannot find module '../src/db/users'`.

- [ ] **Step 3: `src/db/users.ts`**

```ts
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { users, subscriptions } from "./schema";

export type Tier = "assinante" | "gratuito";

export interface HotmartIdentity {
  hotmartUserId: string;
  email: string;
}

export interface Entitlement {
  userId: string;
  email: string;
  role: "admin" | "user";
  tier: Tier;
}

export async function upsertUser(
  db: Db,
  identity: HotmartIdentity,
  adminEmails: string[],
): Promise<string> {
  const role = adminEmails.includes(identity.email.toLowerCase())
    ? "admin"
    : "user";
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, identity.email))
    .get();
  if (existing) {
    await db
      .update(users)
      .set({ hotmartUserId: identity.hotmartUserId, role })
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
      hotmartUserId: identity.hotmartUserId,
      role,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export async function ensureSubscription(
  db: Db,
  userId: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .get();
  if (!existing) {
    await db.insert(subscriptions).values({ userId, status: "none" }).run();
  }
}

export async function loadEntitlement(
  db: Db,
  userId: string,
): Promise<Entitlement | null> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;
  const sub = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .get();
  const tier: Tier = sub?.status === "ACTIVE" ? "assinante" : "gratuito";
  return {
    userId: user.id,
    email: user.email,
    role: user.role as "admin" | "user",
    tier,
  };
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `cd api && npx vitest run test/users.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): repo de usuários (upsert, ensureSubscription, loadEntitlement)"
```

---

## Task 4: JWT de sessão — `signSession`, `verifySession`

**Files:**
- Create: `api/src/lib/jwt.ts`
- Test: `api/test/jwt.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (em `src/lib/jwt.ts`):
  - `signSession(userId: string, secret: string): Promise<string>` (HS256, exp 7d, `sub=userId`)
  - `verifySession(token: string, secret: string): Promise<string | null>` (retorna userId ou `null`)

- [ ] **Step 1: Escreva os testes que falham — `test/jwt.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/lib/jwt";

const secret = "s3cr3t";

describe("jwt de sessão", () => {
  it("assina e verifica, recuperando o userId", async () => {
    const token = await signSession("user-123", secret);
    expect(await verifySession(token, secret)).toBe("user-123");
  });

  it("rejeita token com segredo errado", async () => {
    const token = await signSession("user-123", secret);
    expect(await verifySession(token, "outro")).toBeNull();
  });

  it("rejeita lixo", async () => {
    expect(await verifySession("nao-e-um-jwt", secret)).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/jwt.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: `src/lib/jwt.ts`**

```ts
import { SignJWT, jwtVerify } from "jose";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  userId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `cd api && npx vitest run test/jwt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): JWT de sessão com jose (signSession/verifySession)"
```

---

## Task 5: Cookies de sessão e de state

**Files:**
- Create: `api/src/lib/cookies.ts`
- Test: `api/test/cookies.test.ts`

**Interfaces:**
- Consumes: nada (usa `hono/cookie`).
- Produces (em `src/lib/cookies.ts`, todas recebendo `c: Context`):
  - `setSessionCookie(c, token: string): void`
  - `getSessionCookie(c): string | undefined`
  - `clearSessionCookie(c): void`
  - `setStateCookie(c, state: string, signingKey: string): Promise<void>`
  - `getStateCookie(c, signingKey: string): Promise<string | false | undefined>` (`false` = adulterado)
  - `clearStateCookie(c): void`

- [ ] **Step 1: Escreva o teste que falha — `test/cookies.test.ts`** (via um app Hono mínimo que exercita round-trip)

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  setSessionCookie,
  getSessionCookie,
  setStateCookie,
  getStateCookie,
} from "../src/lib/cookies";

const KEY = "sign-key";

describe("cookies", () => {
  it("sessão: seta com flags de segurança e lê de volta", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setSessionCookie(c, "jwt-token");
      return c.text("ok");
    });
    const res = await app.request("/set");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=jwt-token");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    app.get("/get", (c) => c.text(getSessionCookie(c) ?? "none"));
    const res2 = await app.request("/get", {
      headers: { cookie: "session=jwt-token" },
    });
    expect(await res2.text()).toBe("jwt-token");
  });

  it("state: assina e valida; retorna false se adulterado", async () => {
    const app = new Hono();
    app.get("/set", async (c) => {
      await setStateCookie(c, "abc123", KEY);
      return c.text("ok");
    });
    const res = await app.request("/set");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toContain("oauth_state=");

    app.get("/get", async (c) => {
      const v = await getStateCookie(c, KEY);
      return c.json({ v });
    });
    const ok = await app.request("/get", { headers: { cookie } });
    expect((await ok.json()).v).toBe("abc123");

    const tampered = await app.request("/get", {
      headers: { cookie: cookie + "x" },
    });
    expect((await tampered.json()).v).toBe(false);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/cookies.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: `src/lib/cookies.ts`**

```ts
import type { Context } from "hono";
import {
  getCookie,
  getSignedCookie,
  setCookie,
  setSignedCookie,
  deleteCookie,
} from "hono/cookie";

const SESSION = "session";
const STATE = "oauth_state";

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

export async function setStateCookie(
  c: Context,
  state: string,
  signingKey: string,
): Promise<void> {
  await setSignedCookie(c, STATE, state, signingKey, {
    ...base,
    maxAge: 600,
  });
}

export function getStateCookie(
  c: Context,
  signingKey: string,
): Promise<string | false | undefined> {
  return getSignedCookie(c, signingKey, STATE);
}

export function clearStateCookie(c: Context): void {
  deleteCookie(c, STATE, { path: "/" });
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `cd api && npx vitest run test/cookies.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): cookies de sessão e de state (assinado)"
```

---

## Task 6: Middlewares — `requireSession` e `requireAdmin`

**Files:**
- Create: `api/src/middleware/session.ts`, `api/src/middleware/rbac.ts`
- Test: `api/test/middleware.test.ts`

**Interfaces:**
- Consumes: `Env` (T1), `getSessionCookie` (T5), `verifySession` (T4), `getDb` (T2), `loadEntitlement`/`Entitlement` (T3).
- Produces:
  - `requireSession` (middleware Hono) em `src/middleware/session.ts` — valida cookie de sessão, popula `c.get("entitlement")`; 401 se ausente/inválido.
  - `requireAdmin` (middleware Hono) em `src/middleware/rbac.ts` — exige `entitlement.role === "admin"`; 403 caso contrário. Roda **após** `requireSession`.
  - Tipo do contexto compartilhado: `Variables: { entitlement: Entitlement }`.

- [ ] **Step 1: Escreva os testes que falham — `test/middleware.test.ts`**

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/config/env";
import type { Entitlement } from "../src/db/users";
import { getDb } from "../src/db/client";
import { upsertUser, ensureSubscription } from "../src/db/users";
import { signSession } from "../src/lib/jwt";
import { requireSession } from "../src/middleware/session";
import { requireAdmin } from "../src/middleware/rbac";

type App = { Bindings: Env; Variables: { entitlement: Entitlement } };

function buildApp() {
  const app = new Hono<App>();
  app.get("/protegido", requireSession, (c) =>
    c.json(c.get("entitlement")),
  );
  app.get("/admin", requireSession, requireAdmin, (c) => c.text("admin-ok"));
  return app;
}

async function sessionCookieFor(email: string): Promise<string> {
  const db = getDb(env);
  const id = await upsertUser(db, { hotmartUserId: "h", email }, [
    "admin@test.com",
  ]);
  await ensureSubscription(db, id);
  const token = await signSession(id, env.JWT_SECRET);
  return `session=${token}`;
}

describe("middlewares", () => {
  it("401 sem cookie", async () => {
    const res = await buildApp().request("/protegido", {}, env);
    expect(res.status).toBe(401);
  });

  it("200 com sessão válida e popula entitlement", async () => {
    const cookie = await sessionCookieFor("m1@test.com");
    const res = await buildApp().request(
      "/protegido",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe("m1@test.com");
  });

  it("403 em rota admin para usuário comum", async () => {
    const cookie = await sessionCookieFor("comum@test.com");
    const res = await buildApp().request(
      "/admin",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("200 em rota admin para admin da allowlist", async () => {
    const cookie = await sessionCookieFor("admin@test.com");
    const res = await buildApp().request(
      "/admin",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/middleware.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: `src/middleware/session.ts`**

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { getDb } from "../db/client";
import { loadEntitlement } from "../db/users";
import { getSessionCookie } from "../lib/cookies";
import { verifySession } from "../lib/jwt";

export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>(async (c, next) => {
  const token = getSessionCookie(c);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const userId = await verifySession(token, c.env.JWT_SECRET);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const ent = await loadEntitlement(getDb(c.env), userId);
  if (!ent) return c.json({ error: "unauthorized" }, 401);
  c.set("entitlement", ent);
  await next();
});
```

- [ ] **Step 4: `src/middleware/rbac.ts`**

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>(async (c, next) => {
  const ent = c.get("entitlement");
  if (!ent || ent.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});
```

- [ ] **Step 5: Rode e veja passar**

Run: `cd api && npx vitest run test/middleware.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): middlewares requireSession e requireAdmin (RBAC)"
```

---

## Task 7: Cliente Hotmart — `HotmartClient` + `createHotmartClient`

**Files:**
- Create: `api/src/lib/hotmart.ts`
- Test: `api/test/hotmart.test.ts`

**Interfaces:**
- Consumes: `Env` (T1), `HotmartIdentity` (T3).
- Produces (em `src/lib/hotmart.ts`):
  - `interface HotmartClient { authorizeUrl(state: string): string; exchangeCode(code: string): Promise<{ accessToken: string }>; fetchIdentity(accessToken: string): Promise<HotmartIdentity> }`
  - `createHotmartClient(env: Env): HotmartClient`

> **Verificação manual obrigatória (Task 8, sandbox):** o mapeamento do JSON de `fetchIdentity` (campos `id`/`user_id`/`email`) e as URLs reais de authorize/token/userinfo dependem da resposta real da Hotmart. Confirme contra o sandbox e ajuste `createHotmartClient`/os `HOTMART_*_URL` se divergir. Os testes abaixo fixam o **contrato interno**, não a resposta real da Hotmart.

- [ ] **Step 1: Escreva os testes que falham — `test/hotmart.test.ts`** (usa `fetchMock` do pool-workers)

```ts
import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHotmartClient } from "../src/lib/hotmart";

beforeAll(() => fetchMock.activate());
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("createHotmartClient", () => {
  it("authorizeUrl inclui client_id, redirect_uri, response_type e state", () => {
    const url = new URL(createHotmartClient(env).authorizeUrl("st4te"));
    expect(url.origin + url.pathname).toBe("https://hotmart.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/auth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
  });

  it("exchangeCode troca code por access_token", async () => {
    fetchMock
      .get("https://hotmart.test")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "AT" });
    const out = await createHotmartClient(env).exchangeCode("the-code");
    expect(out.accessToken).toBe("AT");
  });

  it("exchangeCode lança em status != 2xx", async () => {
    fetchMock
      .get("https://hotmart.test")
      .intercept({ path: "/token", method: "POST" })
      .reply(401, {});
    await expect(
      createHotmartClient(env).exchangeCode("bad"),
    ).rejects.toThrow();
  });

  it("fetchIdentity mapeia id e email", async () => {
    fetchMock
      .get("https://hotmart.test")
      .intercept({ path: "/userinfo", method: "GET" })
      .reply(200, { id: 987, email: "quem@test.com" });
    const id = await createHotmartClient(env).fetchIdentity("AT");
    expect(id).toEqual({ hotmartUserId: "987", email: "quem@test.com" });
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/hotmart.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: `src/lib/hotmart.ts`**

```ts
import type { Env } from "../config/env";
import type { HotmartIdentity } from "../db/users";

export interface HotmartClient {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  fetchIdentity(accessToken: string): Promise<HotmartIdentity>;
}

export function createHotmartClient(env: Env): HotmartClient {
  return {
    authorizeUrl(state) {
      const u = new URL(env.HOTMART_AUTHORIZE_URL);
      u.searchParams.set("client_id", env.HOTMART_CLIENT_ID);
      u.searchParams.set("redirect_uri", env.HOTMART_REDIRECT_URI);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("state", state);
      return u.toString();
    },

    async exchangeCode(code) {
      const res = await fetch(env.HOTMART_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.HOTMART_CLIENT_ID,
          client_secret: env.HOTMART_CLIENT_SECRET,
          redirect_uri: env.HOTMART_REDIRECT_URI,
        }),
      });
      if (!res.ok) throw new Error(`token exchange falhou: ${res.status}`);
      const data = (await res.json()) as { access_token: string };
      return { accessToken: data.access_token };
    },

    async fetchIdentity(accessToken) {
      const res = await fetch(env.HOTMART_USERINFO_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`identidade falhou: ${res.status}`);
      const data = (await res.json()) as {
        id?: string | number;
        user_id?: string | number;
        email: string;
      };
      return {
        hotmartUserId: String(data.id ?? data.user_id ?? ""),
        email: data.email,
      };
    },
  };
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `cd api && npx vitest run test/hotmart.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): HotmartClient (authorize/exchange/identity)"
```

---

## Task 8: Rotas de auth — `/login`, `/callback`, `/me`, `/logout`

**Files:**
- Create: `api/src/routes/auth.ts`
- Modify: `api/src/index.ts` (reintroduzir `import { auth }` e `app.route("/auth", auth)`)
- Test: `api/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: tudo das tarefas anteriores — `Env`/`getAdminEmails` (T1), `getDb` (T2), `upsertUser`/`ensureSubscription`/`Entitlement` (T3), `signSession` (T4), cookies (T5), `requireSession` (T6), `createHotmartClient` (T7).
- Produces: `auth` (`Hono<{ Bindings: Env; Variables: { entitlement: Entitlement } }>`) montado em `/auth` no app principal.
  - `GET /auth/login` → 302 para authorize, seta cookie de state.
  - `GET /auth/callback?code&state` → valida state (cookie vs query), troca code, upsert user, ensure subscription, seta cookie de sessão, `{ ok: true }`; 400 em state/oauth inválido.
  - `GET /auth/me` (protegido) → `{ id, email, role, tier }`.
  - `POST /auth/logout` → limpa cookie de sessão, `{ ok: true }`.

- [ ] **Step 1: Escreva os testes que falham — `test/auth-routes.test.ts`**

```ts
import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/index";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";

beforeAll(() => fetchMock.activate());
afterEach(() => fetchMock.assertNoPendingInterceptors());

function cookieFrom(res: Response, name: string): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const m = raw.split(/,(?=[^ ])/).find((p) => p.trim().startsWith(name + "="));
  return m ? m.split(";")[0].trim() : null;
}

describe("/auth", () => {
  it("login redireciona e seta cookie de state", async () => {
    const res = await app.request("/auth/login", {}, env);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("https://hotmart.test/authorize");
    const state = new URL(loc).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(cookieFrom(res, "oauth_state")).toBeTruthy();
  });

  it("callback rejeita state divergente com 400", async () => {
    const res = await app.request(
      "/auth/callback?code=c&state=x",
      { headers: { cookie: "oauth_state=y" } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("callback feliz: cria usuário, seta sessão, e /me funciona", async () => {
    // 1. login para obter state + cookie
    const login = await app.request("/auth/login", {}, env);
    const loc = login.headers.get("location") ?? "";
    const state = new URL(loc).searchParams.get("state")!;
    const stateCookie = cookieFrom(login, "oauth_state")!;

    // 2. stub das chamadas Hotmart
    fetchMock
      .get("https://hotmart.test")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "AT" });
    fetchMock
      .get("https://hotmart.test")
      .intercept({ path: "/userinfo", method: "GET" })
      .reply(200, { id: 42, email: "novo@test.com" });

    // 3. callback
    const cb = await app.request(
      `/auth/callback?code=the-code&state=${state}`,
      { headers: { cookie: stateCookie } },
      env,
    );
    expect(cb.status).toBe(200);
    const session = cookieFrom(cb, "session")!;
    expect(session).toBeTruthy();

    // usuário persistido
    const row = await getDb(env)
      .select()
      .from(users)
      .where(eq(users.email, "novo@test.com"))
      .get();
    expect(row?.hotmartUserId).toBe("42");

    // 4. /me com a sessão
    const me = await app.request("/auth/me", { headers: { cookie: session } }, env);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: row!.id,
      email: "novo@test.com",
      role: "user",
      tier: "gratuito",
    });
  });

  it("logout limpa o cookie de sessão", async () => {
    const res = await app.request("/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `cd api && npx vitest run test/auth-routes.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/auth'` (via `src/index`).

- [ ] **Step 3: `src/routes/auth.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "../config/env";
import { getAdminEmails } from "../config/env";
import type { Entitlement } from "../db/users";
import { getDb } from "../db/client";
import { upsertUser, ensureSubscription } from "../db/users";
import { signSession } from "../lib/jwt";
import {
  setStateCookie,
  getStateCookie,
  clearStateCookie,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/cookies";
import { createHotmartClient } from "../lib/hotmart";
import { requireSession } from "../middleware/session";

export const auth = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

auth.get("/login", async (c) => {
  const state = crypto.randomUUID();
  await setStateCookie(c, state, c.env.COOKIE_SIGNING_KEY);
  return c.redirect(createHotmartClient(c.env).authorizeUrl(state), 302);
});

auth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const stateCookie = await getStateCookie(c, c.env.COOKIE_SIGNING_KEY);
  clearStateCookie(c);
  if (!code || !stateParam || !stateCookie || stateCookie !== stateParam) {
    return c.json({ error: "invalid_state" }, 400);
  }

  const hotmart = createHotmartClient(c.env);
  let identity;
  try {
    const { accessToken } = await hotmart.exchangeCode(code);
    identity = await hotmart.fetchIdentity(accessToken);
  } catch {
    return c.json({ error: "oauth_failed" }, 400);
  }

  const db = getDb(c.env);
  const userId = await upsertUser(db, identity, getAdminEmails(c.env));
  await ensureSubscription(db, userId);
  setSessionCookie(c, await signSession(userId, c.env.JWT_SECRET));
  return c.json({ ok: true });
});

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

- [ ] **Step 4: Reintroduza as rotas em `src/index.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

export default app;
```

- [ ] **Step 5: Rode e veja passar**

Run: `cd api && npx vitest run test/auth-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Rode a suíte inteira**

Run: `cd api && npm test`
Expected: PASS — todos os arquivos (health, db, users, jwt, cookies, middleware, hotmart, auth-routes).

- [ ] **Step 7: Commit**

```bash
cd api && git add -A && git commit -m "feat(api): rotas de auth (login/callback/me/logout) + montagem no app"
```

---

## Task 9: Verificação manual contra o sandbox da Hotmart

**Files:**
- Create: `api/README.md` (roteiro de setup + verificação manual)

**Interfaces:** nenhuma (documentação + verificação end-to-end).

- [ ] **Step 1: Configure os secrets locais** — crie `api/.dev.vars` (adicione ao `.gitignore`; nunca commitar) com os valores reais do sandbox:

```
JWT_SECRET=...
COOKIE_SIGNING_KEY=...
ADMIN_EMAILS=seu-email-admin@dominio.com
HOTMART_CLIENT_ID=...
HOTMART_CLIENT_SECRET=...
HOTMART_REDIRECT_URI=http://localhost:8787/auth/callback
HOTMART_AUTHORIZE_URL=<url real de authorize do sandbox>
HOTMART_TOKEN_URL=<url real de token do sandbox>
HOTMART_USERINFO_URL=<url real de userinfo do sandbox>
```

- [ ] **Step 2: Garanta `.gitignore`** contém `.dev.vars` e `node_modules` (crie/edite `api/.gitignore`).

- [ ] **Step 3: Aplique migrações locais e suba o Worker**

```bash
cd api && npm run db:migrate:local && npm run dev
```

- [ ] **Step 4: Fluxo real no browser** — acesse `http://localhost:8787/auth/login`, faça login no sandbox da Hotmart, e confirme o retorno em `/auth/callback` com `{ ok: true }`.

Expected: cookie `session` setado; sem erro de state.

- [ ] **Step 5: Confirme a sessão** — no mesmo browser (ou com o cookie): `GET http://localhost:8787/auth/me`.

Expected: `{ id, email, role, tier }` com seu e-mail; `role: "admin"` se o e-mail estiver em `ADMIN_EMAILS`.

- [ ] **Step 6: Ajuste `fetchIdentity` se necessário** — se `/auth/me` vier com `email` vazio ou `id` errado, inspecione a resposta real do `HOTMART_USERINFO_URL` e ajuste o mapeamento em `src/lib/hotmart.ts` (e re-rode `npm test`).

- [ ] **Step 7: Documente no `api/README.md`** o roteiro acima (setup de `.dev.vars`, migrações, `npm run dev`, os 3 endpoints de verificação) e commit.

```bash
cd api && git add -A && git commit -m "docs(api): roteiro de verificação manual contra o sandbox Hotmart"
```

---

## Self-Review (cobertura do spec)

- Setup Cloudflare Worker (Hono) → Task 1. ✔
- Migrações `User`/`Subscription` (Drizzle) com `status='none'` placeholder e tier derivado → Tasks 2, 3. ✔
- JWT stateless em cookie, identidade no `sub`, entitlement relido do D1 via `loadEntitlement` (ponto único) → Tasks 3, 4, 6. ✔
- State anti-CSRF em cookie assinado (sem KV) → Tasks 5, 8. ✔
- RBAC no Worker; `role ∈ {admin,user}`; admin via allowlist → Tasks 3, 6. ✔
- `HotmartClient` injetável + mockável; troca de code server-side → Tasks 7, 8. ✔
- Endpoints `/auth/login|callback|me|logout` + `/health` → Tasks 1, 8. ✔
- Cookies HttpOnly/Secure/SameSite=Lax; secrets fora do código → Tasks 5, 9 (Global Constraints). ✔
- Testes Vitest + pool-workers (sucesso e falhas) + verificação manual sandbox → todas as tasks + Task 9. ✔
- Fora de escopo (frontend, Turnstile, webhook/reconciliação, KV, refresh, demais tabelas, CI) → não implementado, por design. ✔
