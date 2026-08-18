# Login do admin — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar a identidade administrativa da identidade do aluno — o admin passa a ser a interseção de `ADMIN_EMAILS` (editada à mão) com uma senha criada por CLI numa tabela `admins`, e nenhum código de aplicação concede privilégio.

**Architecture:** O Cloudflare Access continua sendo a camada de borda, mas passa a ser também a **fonte do email** do admin: uma função única extrai o email do JWT verificado, e nenhuma rota aceita email por corpo, query ou header. As rotas de admin ficam sob `/admin/*` (já coberto por Worker Route e pelo Access); a coluna `users.role` é dropada, e com ela o webhook e o cron deixam de consultar a allowlist.

**Tech Stack:** Cloudflare Workers, Hono 4, Drizzle ORM + D1, jose, Zod, Vitest (`@cloudflare/vitest-pool-workers`), Next.js 16 App Router (`output: export`), Playwright (chromium + WebKit).

**Spec:** [`docs/superpowers/specs/2026-08-18-login-admin-design.md`](../specs/2026-08-18-login-admin-design.md)

## Global Constraints

- **Nenhum pacote novo**, em nenhum workspace. Política do `~/.claude/CLAUDE.md` §5. Tudo abaixo usa o que já está instalado ou a biblioteca padrão do Node.
- **`npm ci`, nunca `npm install`.** Nenhuma tarefa aqui muda dependência.
- **Senha de admin: mínimo 12 caracteres.** O aluno continua em 8 (`MIN_PASSWORD_LENGTH`, `api/src/routes/auth.ts`).
- **O email do admin nunca vem do cliente.** Nem corpo, nem query, nem header de aplicação. Só de `emailDoAccess()`.
- **Nenhum código concede admin.** Não existe rota, script de aplicação ou caminho de webhook que escreva `ADMIN_EMAILS` ou crie linha em `admins`.
- **Sessão de admin: cookie `sessao_admin`, 12 horas.** O do aluno continua `session`, 7 dias.
- **Comentários e documentação em português**, como o resto do repositório. Comentário explica *por quê*, não *o quê*.
- **Testes antes da implementação**, sempre, e commit ao fim de cada tarefa.

## Estrutura de arquivos

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `api/src/db/admins.ts` | acesso à tabela `admins` — três funções, nada mais |
| `api/src/middleware/adminSession.ts` | `requireSessaoAdmin`, as cinco checagens por requisição |
| `api/src/routes/admin/auth.ts` | contexto, login, logout, me, troca de senha |
| `api/scripts/jsonc.mjs` | `stripJsonComments`, extraída de `api/test/admin-guards.test.ts` |
| `api/scripts/senha-admin.mjs` | CLI que cria e rotaciona a senha |
| `api/test/admins.test.ts`, `api/test/admin-auth.test.ts` | testes do banco e das rotas |
| `web/admin/src/app/senha/page.tsx` | tela de troca de senha |
| `web/admin/e2e/senha.spec.ts` | e2e da troca de senha |

**Modificados:** `api/src/db/schema.ts`, `api/src/db/users.ts`, `api/src/config/env.ts`, `api/src/lib/jwt.ts`, `api/src/lib/cookies.ts`, `api/src/middleware/access.ts`, `api/src/app.ts`, `api/src/routes/auth.ts`, `api/src/routes/admin/{taxonomy,questions,media}.ts`, `api/src/webhooks/hotmart.ts`, `api/src/jobs/reconcile.ts`, `api/vitest.config.ts`, `api/package.json`, os testes existentes, e no painel `src/lib/{api.ts,erros.ts,sessao.tsx}`, `src/componentes/Layout.tsx`, `src/app/login/page.tsx`, `e2e/{entrar.ts,seed.mjs,login.spec.ts,caminho-critico.spec.ts}`.

**Removido:** `api/src/middleware/rbac.ts` (substituído por `adminSession.ts`).

---

### Task 1: Tabela `admins` e o módulo de banco

Migração **aditiva** — pode ir a produção antes do Worker novo, e é o que a §11 da spec exige.

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: `api/src/db/admins.ts`
- Create: `api/test/admins.test.ts`
- Create: `api/migrations/0003_*.sql` (gerada)

**Interfaces:**
- Consumes: `Db` de `api/src/db/client.ts`.
- Produces: `admins` (tabela Drizzle); `AdminRow`; `findAdmin(db, email): Promise<AdminRow | undefined>`; `upsertAdmin(db, email, passwordHash): Promise<void>`; `deleteAdmin(db, email): Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/test/admins.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import { findAdmin, upsertAdmin, deleteAdmin } from "../src/db/admins";

const db = () => getDb(env);

describe("db/admins", () => {
  it("upsert cria e findAdmin devolve", async () => {
    await upsertAdmin(db(), "novo@test.com", "hash-1");
    const achado = await findAdmin(db(), "novo@test.com");
    expect(achado?.passwordHash).toBe("hash-1");
  });

  it("upsert do mesmo email troca a senha em vez de duplicar", async () => {
    await upsertAdmin(db(), "rotaciona@test.com", "hash-1");
    await upsertAdmin(db(), "rotaciona@test.com", "hash-2");
    const achado = await findAdmin(db(), "rotaciona@test.com");
    expect(achado?.passwordHash).toBe("hash-2");
  });

  // O email é a chave e vem do token do Access, que não garante caixa.
  it("normaliza o email na escrita e na leitura", async () => {
    await upsertAdmin(db(), "  Maiuscula@Test.com ", "hash-1");
    expect(await findAdmin(db(), "maiuscula@test.com")).toBeDefined();
    expect(await findAdmin(db(), "MAIUSCULA@TEST.COM")).toBeDefined();
  });

  it("deleteAdmin apaga", async () => {
    await upsertAdmin(db(), "sai@test.com", "hash-1");
    await deleteAdmin(db(), "sai@test.com");
    expect(await findAdmin(db(), "sai@test.com")).toBeUndefined();
  });

  it("findAdmin de email inexistente devolve undefined", async () => {
    expect(await findAdmin(db(), "ninguem@test.com")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/admins.test.ts`
Expected: FAIL — `Failed to resolve import "../src/db/admins"`.

- [ ] **Step 3: Declarar a tabela no schema**

Em `api/src/db/schema.ts`, depois de `users`:

```ts
/**
 * O admin não é um usuário. Não tem `id` — a chave natural é o email, que é
 * o que o token do Access carrega — e não tem `role`, porque a tabela inteira
 * é o papel. Ter linha aqui só prova que existe senha; o direito de ser admin
 * vem de `ADMIN_EMAILS`, que nenhum código escreve.
 */
export const admins = sqliteTable("admins", {
  email: text("email").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 4: Gerar e aplicar a migração**

Run: `cd api && npm run db:generate && npm run db:migrate:local`
Expected: cria `migrations/0003_*.sql` com o `CREATE TABLE admins`. Conferir o SQL gerado antes de seguir — deve conter só o `CREATE TABLE`, nada de `DROP`.

- [ ] **Step 5: Escrever o módulo**

Criar `api/src/db/admins.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { admins } from "./schema";
import { normalizeEmail } from "../lib/hmac";

export type AdminRow = typeof admins.$inferSelect;

export function findAdmin(db: Db, email: string): Promise<AdminRow | undefined> {
  return db
    .select()
    .from(admins)
    .where(eq(admins.email, normalizeEmail(email)))
    .get();
}

/** Cria ou rotaciona. Chamado só pelo CLI — nenhuma rota escreve aqui. */
export async function upsertAdmin(
  db: Db,
  email: string,
  passwordHash: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(admins)
    .values({
      email: normalizeEmail(email),
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: admins.email,
      set: { passwordHash, updatedAt: now },
    })
    .run();
}

export async function deleteAdmin(db: Db, email: string): Promise<void> {
  await db.delete(admins).where(eq(admins.email, normalizeEmail(email))).run();
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd api && npx vitest run test/admins.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 7: Suíte inteira e typecheck**

Run: `cd api && npm test && npm run typecheck`
Expected: tudo verde — nada foi removido ainda.

- [ ] **Step 8: Commit**

```bash
git add api/src/db/schema.ts api/src/db/admins.ts api/test/admins.test.ts api/migrations
git commit -m "feat(api): a tabela admins nasce, e o admin deixa de precisar de users"
```

---

### Task 2: `emailDoAccess` e o bypass fail-closed

**Files:**
- Modify: `api/src/config/env.ts`
- Modify: `api/src/middleware/access.ts`
- Modify: `api/vitest.config.ts`
- Modify: `api/test/access.test.ts`

**Interfaces:**
- Consumes: `Env`, `requireAccess`.
- Produces: `emailDoAccess(c): string` — lê a variável de contexto `accessEmail`, gravada por `requireAccess`. Tipo do contexto: `{ Bindings: Env; Variables: { accessEmail: string } }`. Novo campo de `Env`: `ACCESS_DEV_EMAIL?: string`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `api/test/access.test.ts` (o arquivo já tem `withJwks`, `token`, `base` e `buildApp` — reusar):

```ts
// No topo, junto dos outros imports:
// import { requireAccess, emailDoAccess, __resetJwksCache } from "../src/middleware/access";

describe("emailDoAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetJwksCache();
  });

  function appComEco() {
    const app = new Hono<{
      Bindings: Env;
      Variables: { accessEmail: string };
    }>();
    app.get("/admin/eco", requireAccess, (c) => c.text(emailDoAccess(c)));
    return app;
  }

  it("devolve o email do JWT, normalizado", async () => {
    const key = await withJwks();
    const jwt = await new SignJWT({ email: "Fulano@Test.com " })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(key);
    const res = await appComEco().request(
      "/admin/eco",
      { headers: { "cf-access-jwt-assertion": jwt } },
      base(),
    );
    expect(await res.text()).toBe("fulano@test.com");
  });

  it("401 quando o JWT é válido mas não traz email", async () => {
    const key = await withJwks();
    const res = await appComEco().request(
      "/admin/eco",
      { headers: { "cf-access-jwt-assertion": await token(key) } },
      base(),
    );
    expect(res.status).toBe(401);
  });

  it("no bypass de dev, usa ACCESS_DEV_EMAIL", async () => {
    const res = await appComEco().request(
      "/admin/eco",
      {},
      envWith({
        ACCESS_DEV_BYPASS: "true",
        ACCESS_DEV_EMAIL: "admin@dev.local",
      }),
    );
    expect(await res.text()).toBe("admin@dev.local");
  });

  // Fail-closed: bypass ligado sem email não pode virar string vazia, que
  // casaria com uma allowlist vazia mais adiante.
  it("401 com bypass ligado e ACCESS_DEV_EMAIL ausente", async () => {
    const res = await appComEco().request(
      "/admin/eco",
      {},
      envWith({ ACCESS_DEV_BYPASS: "true", ACCESS_DEV_EMAIL: "" }),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/access.test.ts`
Expected: FAIL — `emailDoAccess` não é exportado.

- [ ] **Step 3: Declarar a var no Env e no ambiente de teste**

Em `api/src/config/env.ts`, junto de `ACCESS_DEV_BYPASS`:

```ts
  /**
   * Só existe em `.dev.vars`, e só é lida quando o bypass está ligado. É o
   * email que faz as vezes do que o Access injetaria na borda.
   */
  ACCESS_DEV_EMAIL?: string;
```

Em `api/vitest.config.ts`, dentro de `bindings`, logo abaixo de `ACCESS_DEV_BYPASS: ""`:

```ts
          ACCESS_DEV_EMAIL: "",
```

- [ ] **Step 4: Implementar no middleware**

Em `api/src/middleware/access.ts`: trocar o bloco de comentário do topo (linhas 5-13) e o corpo de `requireAccess`.

Comentário novo do topo:

```ts
/**
 * Primeira das duas camadas de `/admin/*`: o JWT que o Cloudflare Access
 * injeta na borda depois de autenticar a pessoa no IdP (Google/GitHub, com
 * MFA). A segunda é `requireSessaoAdmin`, que exige a senha do painel.
 *
 * O email deste JWT **é** a identidade do admin — não existe outro lugar de
 * onde ela possa vir. Continuam sendo dois fatores independentes (IdP com MFA
 * e senha), agora amarrados ao mesmo email: sem a amarra, quem passasse pelo
 * Access como uma pessoa poderia entrar no painel como outra.
 */
```

Tipo do middleware e corpo:

```ts
type ContextoAccess = { Bindings: Env; Variables: { accessEmail: string } };

export const requireAccess = createMiddleware<ContextoAccess>(
  async (c, next) => {
    // Fail-closed: só a string exata "true" abre, e a var só existe em
    // `.dev.vars`. Em `wrangler dev` nada passa pela borda da Cloudflare, então
    // o header não existe; em produção a var não existe e o header é exigido.
    if (c.env.ACCESS_DEV_BYPASS === "true") {
      // Sem email de desenvolvimento não há identidade nenhuma, e seguir com
      // string vazia casaria com uma allowlist vazia. Barra.
      if (!c.env.ACCESS_DEV_EMAIL) return c.json({ error: "unauthorized" }, 401);
      c.set("accessEmail", normalizeEmail(c.env.ACCESS_DEV_EMAIL));
      await next();
      return;
    }

    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    try {
      const { payload } = await jwtVerify(token, jwksFor(issuer), {
        issuer,
        audience: c.env.ACCESS_AUD,
      });
      if (typeof payload.email !== "string" || !payload.email) {
        return c.json({ error: "unauthorized" }, 401);
      }
      c.set("accessEmail", normalizeEmail(payload.email));
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  },
);

/**
 * A única porta de entrada do email do admin. Toda feature que precisar saber
 * quem é o admin chama isto — nunca lê email de corpo, query ou header de
 * aplicação. Só é chamável depois de `requireAccess`, que é quem grava o valor.
 */
export function emailDoAccess(c: Context<ContextoAccess>): string {
  return c.get("accessEmail");
}
```

Acrescentar aos imports do arquivo:

```ts
import type { Context } from "hono";
import { normalizeEmail } from "../lib/hmac";
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd api && npx vitest run test/access.test.ts`
Expected: PASS.

- [ ] **Step 6: Suíte e typecheck**

Run: `cd api && npm test && npm run typecheck`
Expected: verde. `requireAccess` ganhou uma variável de contexto, mas ninguém a lê ainda.

- [ ] **Step 7: Commit**

```bash
git add api/src/config/env.ts api/src/middleware/access.ts api/vitest.config.ts api/test/access.test.ts
git commit -m "feat(api): o email do admin passa a vir do token do Access, e só de lá"
```

---

### Task 3: A sessão do painel — cookie, JWT e `requireSessaoAdmin`

**Files:**
- Modify: `api/src/lib/jwt.ts`
- Modify: `api/src/lib/cookies.ts`
- Create: `api/src/middleware/adminSession.ts`
- Modify: `api/test/jwt.test.ts`, `api/test/cookies.test.ts`

`api/src/middleware/rbac.ts` **não** é apagado aqui — ver o Step 6.

**Interfaces:**
- Consumes: `emailDoAccess` (Task 2), `findAdmin` (Task 1), `getAdminEmails` (`config/env.ts`).
- Produces: `signAdminSession(email, secret): Promise<string>`; `verifyAdminSession(token, secret): Promise<string | null>`; `setAdminSessionCookie(c, token)`, `getAdminSessionCookie(c)`, `clearAdminSessionCookie(c)`; `requireSessaoAdmin` (middleware).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `api/test/jwt.test.ts`:

```ts
// import { signAdminSession, verifyAdminSession, verifySession, signSession } from "../src/lib/jwt";

describe("sessão de admin", () => {
  it("ida e volta devolve o email", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifyAdminSession(t, "s")).toBe("admin@test.com");
  });

  it("segredo errado devolve null", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifyAdminSession(t, "outro")).toBeNull();
  });

  // Os dois cookies vivem em hostnames diferentes em produção, mas dividem
  // localhost em desenvolvimento. O `typ` é o que impede um valer pelo outro.
  it("token de aluno não passa por sessão de admin", async () => {
    const t = await signSession("id-de-usuario", "s");
    expect(await verifyAdminSession(t, "s")).toBeNull();
  });

  it("token de admin não passa por sessão de aluno", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifySession(t, "s")).toBeNull();
  });
});
```

Acrescentar a `api/test/cookies.test.ts` (seguir o estilo dos casos que já existem lá para `session`): um caso afirmando que `setAdminSessionCookie` emite `sessao_admin` com `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` e `Max-Age=43200`, e um afirmando que `clearAdminSessionCookie` zera o valor.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/jwt.test.ts test/cookies.test.ts`
Expected: FAIL — funções não exportadas.

- [ ] **Step 3: Implementar jwt e cookies**

Em `api/src/lib/jwt.ts`, acrescentar:

```ts
/**
 * A sessão do painel. `sub` é o email (a chave de `admins`), e `typ` separa
 * este token do de aluno: os dois são assinados com o mesmo segredo e, em
 * desenvolvimento, convivem no mesmo localhost.
 *
 * Doze horas, contra os sete dias do aluno: sessão de painel administrativo
 * não deveria sobreviver a um fim de semana.
 */
export async function signAdminSession(
  email: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ typ: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key(secret));
}

export async function verifyAdminSession(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
    });
    if (payload.typ !== "admin") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
```

E dentro de `verifySession`, logo antes do `return`, a recusa simétrica:

```ts
    // Sessão de admin não vale como sessão de aluno. Tokens antigos de aluno
    // não têm `typ` nenhum e continuam valendo — por isso a checagem é pela
    // presença do valor de admin, não pela ausência de um valor de aluno.
    if (payload.typ === "admin") return null;
```

Em `api/src/lib/cookies.ts`:

```ts
const SESSION = "session";
/** Nome próprio: em dev os dois frontends dividem localhost. */
const ADMIN_SESSION = "sessao_admin";
const DOZE_HORAS = 60 * 60 * 12;

export function setAdminSessionCookie(c: Context, token: string): void {
  setCookie(c, ADMIN_SESSION, token, { ...base, maxAge: DOZE_HORAS });
}

export function getAdminSessionCookie(c: Context): string | undefined {
  return getCookie(c, ADMIN_SESSION);
}

export function clearAdminSessionCookie(c: Context): void {
  deleteCookie(c, ADMIN_SESSION, { path: "/" });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run test/jwt.test.ts test/cookies.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o middleware**

Criar `api/src/middleware/adminSession.ts`:

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import { getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { findAdmin } from "../db/admins";
import { getAdminSessionCookie } from "../lib/cookies";
import { verifyAdminSession } from "../lib/jwt";
import { emailDoAccess } from "./access";

/**
 * Segunda camada de `/admin/*`, e cinco checagens a cada requisição:
 *
 * 1. cookie presente;
 * 2. JWT válido e do tipo certo;
 * 3. o email da sessão é o mesmo do token do Access;
 * 4. o email está em ADMIN_EMAILS;
 * 5. existe senha cadastrada.
 *
 * As três últimas são lidas a cada requisição de propósito: tirar um email da
 * allowlist e publicar, ou apagar a linha de `admins`, derruba a sessão viva
 * na requisição seguinte, sem lista de revogação. É o mesmo princípio de
 * `loadEntitlement`, que deriva o tier em vez de carregá-lo no JWT.
 *
 * A checagem 3 é a regra que amarra o painel ao Access: uma sessão obtida por
 * uma pessoa não vale com o token de outra.
 */
export const requireSessaoAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>(async (c, next) => {
  const token = getAdminSessionCookie(c);
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const email = await verifyAdminSession(token, c.env.JWT_SECRET);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  if (email !== emailDoAccess(c)) return c.json({ error: "unauthorized" }, 401);

  if (!getAdminEmails(c.env).includes(email)) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!(await findAdmin(getDb(c.env), email))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
});
```

- [ ] **Step 6: Suíte e typecheck**

Run: `cd api && npm test && npm run typecheck`
Expected: verde. `requireSessaoAdmin` existe mas ainda não está montado em rota nenhuma, e `rbac.ts` continua no lugar — quem o apaga é a Task 4, que religa o `app.ts` no mesmo commit. Terminar esta tarefa com o `rbac.ts` já removido deixaria o repositório sem compilar.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/jwt.ts api/src/lib/cookies.ts api/src/middleware/adminSession.ts api/test/jwt.test.ts api/test/cookies.test.ts
git commit -m "feat(api): a sessão do painel ganha cookie, tipo e cinco checagens"
```

---

### Task 4: As rotas `/admin/auth/*` e a remontagem do app

Tarefa grande porque é indivisível: as rotas novas, a troca do guarda antigo pelo novo e os testes de guarda formam um único estado compilável.

**Files:**
- Create: `api/src/routes/admin/auth.ts`
- Create: `api/test/admin-auth.test.ts`
- Modify: `api/src/app.ts`
- Modify: `api/src/routes/admin/taxonomy.ts:16-19`, `api/src/routes/admin/questions.ts:18-21`, `api/src/routes/admin/media.ts` (só o tipo do `Hono<>`)
- Modify: `api/test/admin-guards.test.ts`
- Delete: `api/src/middleware/rbac.ts`

**Interfaces:**
- Consumes: `emailDoAccess` (Task 2), `requireSessaoAdmin` (Task 3), `findAdmin`/`upsertAdmin` (Task 1), `hashPassword`/`verifyPassword` (`lib/password.ts`), `signAdminSession` + cookies (Task 3).
- Produces: `adminAuth` (router Hono) e as rotas `GET /admin/auth/contexto`, `POST /admin/auth/login`, `POST /admin/auth/logout`, `GET /admin/auth/me`, `POST /admin/auth/senha`. Constante exportada `MIN_SENHA_ADMIN = 12`. Contrato de erro: `invalid_request` (400), `weak_password` (400), `senha_atual_incorreta` (400), `invalid_credentials` (401), `unauthorized` (401), `forbidden` (403).

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/test/admin-auth.test.ts`. O bypass de dev é o caminho mais curto para ter um email do Access nos testes de rota — `access.test.ts` já cobre a verificação do JWT de verdade, então repeti-la aqui só compraria lentidão:

```ts
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/app";
import { getDb } from "../src/db/client";
import { upsertAdmin, findAdmin, deleteAdmin } from "../src/db/admins";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { signAdminSession } from "../src/lib/jwt";
import { envWith, cookieFrom } from "./helpers";

const ADMIN = "admin@test.com"; // o mesmo de ADMIN_EMAILS no vitest.config
const FORA = "fora-da-lista@test.com";
const SENHA = "senha-de-doze-ou-mais";

/** Bypass ligado: o email do Access vem de ACCESS_DEV_EMAIL. */
const comoAccess = (email: string) =>
  envWith({ ACCESS_DEV_BYPASS: "true", ACCESS_DEV_EMAIL: email });

async function cookieDe(email: string): Promise<string> {
  return `sessao_admin=${await signAdminSession(email, env.JWT_SECRET)}`;
}

beforeEach(async () => {
  await deleteAdmin(getDb(env), ADMIN);
  await deleteAdmin(getDb(env), FORA);
});

describe("GET /admin/auth/contexto", () => {
  it("email na allowlist e sem senha: ehAdmin true, temSenha false", async () => {
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(ADMIN));
    expect(await res.json()).toEqual({
      email: ADMIN,
      ehAdmin: true,
      temSenha: false,
    });
  });

  it("com senha cadastrada, temSenha vira true", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(ADMIN));
    expect(await res.json()).toMatchObject({ ehAdmin: true, temSenha: true });
  });

  it("email fora da allowlist: ehAdmin false", async () => {
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(FORA));
    expect(await res.json()).toMatchObject({ email: FORA, ehAdmin: false });
  });
});

describe("POST /admin/auth/login", () => {
  async function entrar(body: unknown, email = ADMIN) {
    return app.request(
      "/admin/auth/login",
      { method: "POST", body: JSON.stringify(body) },
      comoAccess(email),
    );
  }

  it("senha certa emite o cookie sessao_admin", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await entrar({ senha: SENHA });
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "sessao_admin")).toBeTruthy();
  });

  it("senha errada é 401 e não emite cookie", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await entrar({ senha: "errada-mas-longa" });
    expect(res.status).toBe(401);
    expect(cookieFrom(res, "sessao_admin")).toBeNull();
  });

  it("email fora da allowlist é 403 mesmo com senha cadastrada", async () => {
    await upsertAdmin(getDb(env), FORA, await hashPassword(SENHA));
    const res = await entrar({ senha: SENHA }, FORA);
    expect(res.status).toBe(403);
  });

  it("sem linha em admins é 401", async () => {
    const res = await entrar({ senha: SENHA });
    expect(res.status).toBe(401);
  });

  // A invariante da spec §5: não existe caminho pelo qual o cliente escolha
  // de quem é a senha que está sendo conferida.
  it("email no corpo é ignorado", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    await upsertAdmin(getDb(env), FORA, await hashPassword("outra-senha-longa"));
    const res = await entrar({ senha: "outra-senha-longa", email: FORA });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/auth/me", () => {
  it("devolve o email do Access, não o do cookie", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await app.request(
      "/admin/auth/me",
      { headers: { cookie: await cookieDe(ADMIN) } },
      comoAccess(ADMIN),
    );
    expect(await res.json()).toEqual({ email: ADMIN });
  });

  it("401 quando o cookie é de um email e o Access é de outro", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    await upsertAdmin(getDb(env), FORA, await hashPassword(SENHA));
    const res = await app.request(
      "/admin/auth/me",
      { headers: { cookie: await cookieDe(FORA) } },
      comoAccess(ADMIN),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/auth/senha", () => {
  async function trocar(body: unknown) {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    return app.request(
      "/admin/auth/senha",
      {
        method: "POST",
        headers: { cookie: await cookieDe(ADMIN) },
        body: JSON.stringify(body),
      },
      comoAccess(ADMIN),
    );
  }

  it("troca a senha quando a atual confere", async () => {
    const res = await trocar({ senhaAtual: SENHA, nova: "nova-senha-comprida" });
    expect(res.status).toBe(200);
    const linha = await findAdmin(getDb(env), ADMIN);
    expect(await verifyPassword("nova-senha-comprida", linha!.passwordHash)).toBe(
      true,
    );
  });

  it("senha atual errada é 400 e não troca nada", async () => {
    const res = await trocar({ senhaAtual: "nao-e-essa", nova: "nova-senha-comprida" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "senha_atual_incorreta" });
    const linha = await findAdmin(getDb(env), ADMIN);
    expect(await verifyPassword(SENHA, linha!.passwordHash)).toBe(true);
  });

  it("nova senha com menos de 12 caracteres é 400", async () => {
    const res = await trocar({ senhaAtual: SENHA, nova: "curta12345" });
    expect(await res.json()).toEqual({ error: "weak_password" });
  });

  it("sem sessão é 401", async () => {
    const res = await app.request(
      "/admin/auth/senha",
      { method: "POST", body: JSON.stringify({ senhaAtual: SENHA, nova: "x".repeat(12) }) },
      comoAccess(ADMIN),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/admin-auth.test.ts`
Expected: FAIL — 404 em todas as rotas.

- [ ] **Step 3: Escrever as rotas**

Criar `api/src/routes/admin/auth.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env";
import { getAdminEmails } from "../../config/env";
import { getDb } from "../../db/client";
import { findAdmin, upsertAdmin } from "../../db/admins";
import { hashPassword, verifyPassword } from "../../lib/password";
import { signAdminSession } from "../../lib/jwt";
import { setAdminSessionCookie, clearAdminSessionCookie } from "../../lib/cookies";
import { emailDoAccess } from "../../middleware/access";
import { requireSessaoAdmin } from "../../middleware/adminSession";

/** Mais que os 8 do aluno: são três pessoas e a senha é digitada raramente. */
export const MIN_SENHA_ADMIN = 12;

export const adminAuth = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();

/**
 * O que a tela de login precisa saber para escolher entre os três estados.
 * Vive atrás do Access, então quem o alcança já passou pelo IdP — não há
 * enumeração possível aqui: o email não é escolhido por quem chama.
 */
adminAuth.get("/contexto", async (c) => {
  const email = emailDoAccess(c);
  const ehAdmin = getAdminEmails(c.env).includes(email);
  const temSenha = ehAdmin && !!(await findAdmin(getDb(c.env), email));
  return c.json({ email, ehAdmin, temSenha });
});

const loginSchema = z.object({ senha: z.string() });

adminAuth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  // O email NUNCA vem do corpo. Um `email` enviado junto é ignorado pelo
  // schema e não tem para onde ir.
  const email = emailDoAccess(c);
  if (!getAdminEmails(c.env).includes(email)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const admin = await findAdmin(getDb(c.env), email);
  // Sem hash descartável, ao contrário de /auth/login: lá o tempo de resposta
  // seria um oráculo de existência de conta; aqui quem chama já passou pelo
  // IdP, o email é o dele, e /admin/auth/contexto informa `temSenha` de
  // propósito. Não há o que enumerar.
  if (!admin || !(await verifyPassword(parsed.data.senha, admin.passwordHash))) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  setAdminSessionCookie(c, await signAdminSession(email, c.env.JWT_SECRET));
  return c.json({ ok: true });
});

/** Encerra só a sessão do painel — a do Access é outra e continua viva. */
adminAuth.post("/logout", (c) => {
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

adminAuth.get("/me", requireSessaoAdmin, (c) =>
  c.json({ email: emailDoAccess(c) }),
);

const senhaSchema = z.object({ senhaAtual: z.string(), nova: z.string() });

adminAuth.post("/senha", requireSessaoAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = senhaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  if (parsed.data.nova.length < MIN_SENHA_ADMIN) {
    return c.json({ error: "weak_password" }, 400);
  }

  const email = emailDoAccess(c);
  const admin = await findAdmin(getDb(c.env), email);
  // requireSessaoAdmin já garantiu que existe; o `!admin` é para o TypeScript.
  if (!admin || !(await verifyPassword(parsed.data.senhaAtual, admin.passwordHash))) {
    return c.json({ error: "senha_atual_incorreta" }, 400);
  }

  await upsertAdmin(getDb(c.env), email, await hashPassword(parsed.data.nova));
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Religar o `app.ts`**

Substituir o bloco de `/admin` em `api/src/app.ts` (linhas 28-40) por:

```ts
/**
 * Duas camadas independentes, nesta ordem:
 * 1. requireAccess — o JWT que o Cloudflare Access injeta na borda (identidade
 *    + MFA no IdP). Barra antes de qualquer consulta ao banco, e é quem grava
 *    o email que `emailDoAccess` devolve.
 * 2. requireSessaoAdmin — a sessão do painel, com a senha própria.
 *
 * `/admin/auth/*` fica só sob a camada 1, por definição: é onde a sessão da
 * camada 2 nasce. As rotas de conteúdo ficam sob as duas, agrupadas em
 * `adminProtegido` — um sub-router em vez de `app.use("/admin/...")` porque
 * `/admin/taxonomy/*` não casa `/admin/taxonomy`, e é exatamente nesse
 * caminho sem barra que mora o `GET` da listagem.
 *
 * A ordem de registro importa: `adminAuth` é montado antes, e seus handlers
 * respondem sem passar pelo `use("*")` de `adminProtegido`. Os testes de
 * `admin-guards.test.ts` prendem esse comportamento.
 */
app.use("/admin/*", requireAccess);
app.route("/admin/auth", adminAuth);

const adminProtegido = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();
adminProtegido.use("*", requireSessaoAdmin);
adminProtegido.route("/taxonomy", adminTaxonomy);
adminProtegido.route("/questions", adminQuestions);
adminProtegido.route("/media", adminMedia);
app.route("/admin", adminProtegido);
```

Ajustar os imports do arquivo: sai `requireSession` e `requireAdmin`, entram `adminAuth` e `requireSessaoAdmin`. O tipo do `app` passa de `Variables: { entitlement: Entitlement }` para `Variables: { accessEmail: string }`, e o import de `Entitlement` sai.

Nos três routers de conteúdo (`routes/admin/taxonomy.ts`, `questions.ts`, `media.ts`), trocar o genérico:

```ts
export const adminTaxonomy = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();
```

e apagar o `import type { Entitlement }` de cada um — nenhum dos três lê `entitlement`, só o declarava.

- [ ] **Step 5: Apagar o guarda antigo**

Run: `cd api && git rm src/middleware/rbac.ts`

- [ ] **Step 6: Atualizar os testes de guarda**

Em `api/test/admin-guards.test.ts`:

- `sessionCookie(email)` vira `cookieAdmin(email)`, emitindo `sessao_admin` com `signAdminSession` e criando a linha em `admins` com `upsertAdmin` (a função some do arquivo de teste junto com `upsertUserFromPurchase`);
- o caso "403 com Access válido e sessão de usuário comum" passa a ser "403 com Access válido e sessão de email fora da allowlist";
- acrescentar três casos novos:

```ts
  it("403 quando o email está na allowlist mas não tem senha", async () => {
    const token = await accessToken();
    const cookie = `sessao_admin=${await signAdminSession("admin@test.com", env.JWT_SECRET)}`;
    await deleteAdmin(getDb(env), "admin@test.com");
    const res = await app.request(
      "/admin/taxonomy?kind=banca",
      { headers: { "cf-access-jwt-assertion": token, cookie } },
      prod(),
    );
    expect(res.status).toBe(403);
  });

  // A ordem de montagem em app.ts: o login não pode exigir a sessão que ele
  // mesmo cria. Um 401 aqui significaria que o guarda vazou para /admin/auth.
  it("o login não fica atrás da sessão", async () => {
    const token = await accessToken();
    const res = await app.request(
      "/admin/auth/login",
      {
        method: "POST",
        headers: { "cf-access-jwt-assertion": token },
        body: JSON.stringify({ senha: "qualquer-coisa" }),
      },
      prod(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("o login continua atrás do Access", async () => {
    const res = await app.request(
      "/admin/auth/login",
      { method: "POST", body: JSON.stringify({ senha: "qualquer-coisa" }) },
      prod(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
```

- [ ] **Step 7: Rodar tudo**

Run: `cd api && npm test && npm run typecheck`
Expected: PASS. Se `admin-guards.test.ts` falhar em "401 com sessão de admin mas sem Access", conferir que `requireAccess` continua montado em `/admin/*` **antes** de qualquer rota.

- [ ] **Step 8: Commit**

```bash
git add api/src/routes/admin api/src/app.ts api/test/admin-auth.test.ts api/test/admin-guards.test.ts
git commit -m "feat(api): o painel ganha login próprio, e o guarda antigo sai de cena"
```

---

### Task 5: `role` sai do banco e do fluxo do aluno

Migração **destrutiva**. Em produção ela é o último passo (spec §11); no repositório vem aqui, depois que nada mais lê a coluna.

**Files:**
- Modify: `api/src/db/schema.ts:18`, `api/src/db/users.ts`, `api/src/routes/auth.ts:29-37`, `api/src/webhooks/hotmart.ts:165-170`, `api/src/jobs/reconcile.ts:113-118`
- Modify: `api/test/users.test.ts`, `api/test/webhook-purchase.test.ts`, `api/test/reconcile.test.ts`, `api/test/auth-login.test.ts`
- Create: `api/migrations/0004_*.sql` (gerada)

**Interfaces:**
- Produces: `upsertUserFromPurchase(db, identity): Promise<string>` — **sem** o terceiro parâmetro `adminEmails`. `Entitlement` = `{ userId, email, name, tier }`, sem `role`. `GET /auth/me` devolve `{ id, email, name, tier }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/test/users.test.ts`, trocar as chamadas de `upsertUserFromPurchase` para dois argumentos e acrescentar:

```ts
  it("o entitlement não tem papel nenhum", async () => {
    const id = await upsertUserFromPurchase(getDb(env), {
      email: "admin@test.com", // o email da allowlist, de propósito
      name: null,
      documentHash: null,
    });
    const ent = await loadEntitlement(getDb(env), id);
    expect(ent).not.toHaveProperty("role");
  });
```

Em `api/test/auth-login.test.ts`, acrescentar:

```ts
  // Uma compra com email de admin cria uma conta de ALUNO, e é só isso que
  // ela cria (spec §3). O painel não olha para `users`.
  it("/auth/me não devolve role", async () => {
    // ...login com um usuário criado por compra, como os casos vizinhos já
    // fazem, e então:
    expect(await res.json()).not.toHaveProperty("role");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/users.test.ts test/auth-login.test.ts`
Expected: FAIL — erro de tipo por argumento a mais e `role` ainda presente.

- [ ] **Step 3: Podar o `users.ts`**

Em `api/src/db/users.ts`: tirar `role` de `Entitlement`, tirar o parâmetro `adminEmails` e a linha `const role = …`, tirar `role` dos dois blocos de escrita e do retorno de `loadEntitlement`. O bloco de comentário de `upsertUserFromPurchase` perde a linha sobre `role` e ganha:

```ts
 * - Não existe papel aqui. Admin é outro sistema (`db/admins.ts`), e uma
 *   compra com email de admin cria uma conta de aluno como outra qualquer.
```

- [ ] **Step 4: Podar os chamadores**

`api/src/webhooks/hotmart.ts` e `api/src/jobs/reconcile.ts`: remover o argumento `getAdminEmails(env)` das chamadas e o import de `getAdminEmails` (o `getSubscriptionUcodes` continua). `api/src/routes/auth.ts`: remover `role: ent.role` do JSON de `/auth/me`.

- [ ] **Step 5: Dropar a coluna**

Remover a linha `role: text("role").notNull().default("user"),` de `api/src/db/schema.ts`.

Run: `cd api && npm run db:generate && npm run db:migrate:local`
Expected: `migrations/0004_*.sql` com `ALTER TABLE users DROP COLUMN role`. Conferir que a migração **só** contém isso.

- [ ] **Step 6: Rodar tudo**

Run: `cd api && npm test && npm run typecheck`
Expected: PASS. Testes que ainda passem três argumentos ou esperem `role` no corpo precisam ser ajustados — a poda é mecânica.

- [ ] **Step 7: Commit**

```bash
git add api/src api/test api/migrations
git commit -m "refactor(api): o papel sai do banco, e com ele o último jeito de conceder admin por código"
```

---

### Task 6: O CLI de senha

**Files:**
- Create: `api/scripts/jsonc.mjs`
- Create: `api/scripts/senha-admin.mjs`
- Modify: `api/package.json` (script `admin:senha`)
- Modify: `api/test/admin-guards.test.ts` (passa a importar a função extraída)

**Interfaces:**
- Consumes: a tabela `admins` (Task 1) e o `wrangler` já instalado.
- Produces: `stripJsonComments(texto): string` exportada de `api/scripts/jsonc.mjs`; o comando `npm run admin:senha -- <email> [--local] [--remover]`.

> **Desvio da spec, deliberado:** a §8 previa extrair `ADMIN_EMAILS` com um
> regex, para não precisar de um parser de JSONC. Acontece que o repositório já
> tem um parser correto — `stripJsonComments` em `api/test/admin-guards.test.ts`,
> que respeita strings e por isso não corta `"https://…"` ao meio. Extrair a
> função para `scripts/jsonc.mjs` e usá-la nos dois lugares custa menos que
> manter um regex frouxo, e não traz pacote nenhum.

- [ ] **Step 1: Extrair o parser de JSONC**

Criar `api/scripts/jsonc.mjs` com a função `stripJsonComments` **exatamente** como está hoje em `api/test/admin-guards.test.ts:13-61` — o corpo inteiro, incluindo o bloco de comentário que explica por que não é um regex —, trocando a assinatura tipada por `export function stripJsonComments(text)` e tirando as anotações de tipo.

Em `api/test/admin-guards.test.ts`, apagar a cópia local e importar:

```ts
import { stripJsonComments } from "../scripts/jsonc.mjs";
```

- [ ] **Step 2: Conferir que nada quebrou**

Run: `cd api && npx vitest run test/admin-guards.test.ts && npm run typecheck`
Expected: PASS — mesmo comportamento, uma cópia a menos.

- [ ] **Step 3: Escrever o CLI**

Criar `api/scripts/senha-admin.mjs`:

```js
/**
 * Cria ou rotaciona a senha de um admin.
 *
 * É o único jeito de uma linha nascer em `admins` — nenhuma rota escreve lá.
 * O direito de ser admin não vem daqui: vem de `ADMIN_EMAILS`, em
 * `wrangler.jsonc`, editado à mão. Este script só instala a senha de quem já
 * está na lista.
 *
 * Uso:
 *   npm run admin:senha -- pessoa@dominio.com            (D1 remoto)
 *   npm run admin:senha -- pessoa@dominio.com --local    (D1 de desenvolvimento)
 *   npm run admin:senha -- pessoa@dominio.com --remover
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripJsonComments } from "./jsonc.mjs";

const ITERACOES = 100_000;
const MIN_SENHA = 12;
const RAIZ = new URL("..", import.meta.url).pathname;

// Escritos por código para não deixar byte de controle solto no fonte.
const EOT = String.fromCharCode(4);
const ETX = String.fromCharCode(3);
const DEL = String.fromCharCode(127);

function normalizar(email) {
  return email.trim().toLowerCase();
}

function allowlist() {
  const bruto = readFileSync(join(RAIZ, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripJsonComments(bruto));
  const csv = config.vars?.ADMIN_EMAILS;
  if (typeof csv !== "string") {
    throw new Error("ADMIN_EMAILS não encontrado em wrangler.jsonc");
  }
  return csv.split(",").map(normalizar).filter(Boolean);
}

/**
 * Lê sem eco. O `readline` não oferece isso sem mexer em API privada, então o
 * caminho é o terminal cru: nada é impresso de volta enquanto a pessoa digita.
 */
function perguntaSenha(rotulo) {
  process.stdout.write(rotulo);
  const { stdin } = process;
  if (!stdin.isTTY) {
    throw new Error("este script precisa de um terminal interativo");
  }
  return new Promise((resolve) => {
    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const aoDado = (chunk) => {
      // Colar uma senha entrega vários caracteres num chunk só.
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === EOT) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", aoDado);
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (ch === ETX) {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === DEL || ch === "\b") buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.on("data", aoDado);
  });
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

/** Mesmo formato de api/src/lib/password.ts. */
async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERACOES, hash: "SHA-256" },
    chave,
    256,
  );
  return `pbkdf2$sha256$${ITERACOES}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const aspas = (valor) => `'${valor.replace(/'/g, "''")}'`;

/**
 * O SQL vai por arquivo, não por `--command`: um argumento de linha de comando
 * fica visível em `ps` para qualquer processo da máquina e cai no histórico do
 * shell. O hash não é a senha, mas também não é para circular.
 */
function executarSql(sql, local) {
  const arquivo = join(mkdtempSync(join(tmpdir(), "admin-senha-")), "comando.sql");
  writeFileSync(arquivo, sql, { mode: 0o600 });
  try {
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "mais-aprovacao-db",
        local ? "--local" : "--remote",
        "--file",
        arquivo,
      ],
      { cwd: RAIZ, stdio: "inherit" },
    );
  } finally {
    unlinkSync(arquivo);
  }
}

const args = process.argv.slice(2);
const local = args.includes("--local");
const remover = args.includes("--remover");
const alvo = args.find((a) => !a.startsWith("--"));

if (!alvo) {
  console.error("uso: npm run admin:senha -- <email> [--local] [--remover]");
  process.exit(1);
}

const email = normalizar(alvo);

// Conveniência, não fronteira: quem decide de verdade é requireSessaoAdmin,
// que confere ADMIN_EMAILS a cada requisição. Isto só evita criar uma senha
// que nunca serviria para nada.
if (!allowlist().includes(email)) {
  console.error(
    `${email} não está em ADMIN_EMAILS (api/wrangler.jsonc).\n` +
      "Acrescente o email à lista, publique o Worker e rode de novo.",
  );
  process.exit(1);
}

const agora = Date.now();

if (remover) {
  executarSql(`delete from admins where email = ${aspas(email)};`, local);
  console.log(`senha de ${email} removida${local ? " (local)" : ""}`);
} else {
  const senha = await perguntaSenha(`senha para ${email}: `);
  const confirmacao = await perguntaSenha("confirme: ");
  if (senha !== confirmacao) {
    console.error("as senhas não conferem");
    process.exit(1);
  }
  if (senha.length < MIN_SENHA) {
    console.error(`a senha precisa de pelo menos ${MIN_SENHA} caracteres`);
    process.exit(1);
  }
  const hash = await hashSenha(senha);
  executarSql(
    `insert into admins (email, password_hash, created_at, updated_at)
     values (${aspas(email)}, ${aspas(hash)}, ${agora}, ${agora})
     on conflict(email) do update
       set password_hash = excluded.password_hash,
           updated_at = excluded.updated_at;`,
    local,
  );
  console.log(`senha de ${email} definida${local ? " (local)" : ""}`);
}
```

- [ ] **Step 4: Registrar o script**

Em `api/package.json`, em `scripts`:

```json
    "admin:senha": "node scripts/senha-admin.mjs",
```

- [ ] **Step 5: Exercitar contra o D1 local**

```bash
cd api && npm run db:migrate:local
npm run admin:senha -- nao-existe@test.com
npm run admin:senha -- dudu@zava.dev.br --local
npx wrangler d1 execute mais-aprovacao-db --local --command "select email from admins"
npm run admin:senha -- dudu@zava.dev.br --local --remover
```

Expected: a primeira chamada recusa falando em `ADMIN_EMAILS` e sai com código 1; a segunda pede a senha duas vezes sem ecoar nada; o `select` mostra o email; o `--remover` esvazia a tabela.

- [ ] **Step 6: Commit**

```bash
git add api/scripts api/package.json api/test/admin-guards.test.ts
git commit -m "feat(api): a senha do admin nasce no terminal, e o SQL não passa pelo argv"
```

---

### Task 7: O painel — cliente, sessão e a tela de login

Tarefa grande porque a suíte e2e só volta ao verde com tudo junto: cliente, guarda de rota, topbar, tela e semente.

**Files:**
- Modify: `web/admin/src/lib/api.ts`, `web/admin/src/lib/erros.ts`, `web/admin/src/lib/sessao.tsx`
- Modify: `web/admin/src/componentes/Layout.tsx`
- Modify: `web/admin/src/app/login/page.tsx`
- Modify: `web/admin/e2e/entrar.ts`, `web/admin/e2e/seed.mjs`, `web/admin/e2e/login.spec.ts`, `web/admin/e2e/caminho-critico.spec.ts:8-20`
- Modify: `api/.dev.vars` (local, fora do git)

**Interfaces:**
- Consumes: `/admin/auth/{contexto,login,logout,me}` (Task 4).
- Produces: `api.contexto()`, `api.entrar(senha)`, `api.sair()`, `api.me()`, `api.trocarSenha(senhaAtual, nova)`; tipo `ContextoAdmin = { email: string; ehAdmin: boolean; temSenha: boolean }`; `useSessao(): { carregando: boolean; admin: { email: string } | null }`.

- [ ] **Step 1: Preparar o ambiente de desenvolvimento**

Acrescentar a `api/.dev.vars`:

```
ACCESS_DEV_EMAIL=admin@dev.local
ADMIN_EMAILS=admin@dev.local
```

O `ADMIN_EMAILS` daqui **sobrepõe** o de `wrangler.jsonc` no `wrangler dev`. É o que permite desenvolver sem pôr um email real na allowlist local nem um email de mentira na de produção. Os dois valores precisam casar com o `EMAIL` de `web/admin/e2e/credenciais.mjs`.

- [ ] **Step 2: Reescrever a semente**

Em `web/admin/e2e/seed.mjs`, trocar as duas últimas instruções de `semear()`:

```js
  d1(`delete from admins where email = '${EMAIL}'`);
  d1(
    `insert into admins (email, password_hash, created_at, updated_at)
     values ('${EMAIL}', '${hash}', ${agora}, ${agora})`,
  );
```

O `delete from users where email = …` e o `insert into users …` saem: o painel não tem mais linha em `users`. O bloco de comentário do topo passa a dizer que a senha vai para `admins`, e que `EMAIL` precisa casar com o `ACCESS_DEV_EMAIL` e o `ADMIN_EMAILS` do `.dev.vars`.

- [ ] **Step 3: Escrever os testes e2e que falham**

Reescrever `web/admin/e2e/login.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { aguardarFormularioVivo } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("sem sessão, qualquer tela redireciona para o login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a tela mostra o email do Access e não pede email", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

test("senha errada mostra a mensagem e não entra", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill("senha-errada-mas-longa");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /senha inválida/i,
  );
  await expect(page).toHaveURL(/\/login/);
});

test("senha certa entra e a topbar mostra o email", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(EMAIL)).toBeVisible();
});

test("sair limpa a sessão e volta ao login", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

// Os dois estados abaixo dependem do que o Access mandaria, que em
// desenvolvimento é fixo — então o contexto é interceptado. É o mesmo recurso
// que visual.spec.ts já usa para fixar a lista de questões.
test("email fora da allowlist vê a recusa, sem campo de senha", async ({
  page,
}) => {
  await page.route("**/admin/auth/contexto", (rota) =>
    rota.fulfill({
      json: { email: "outra@pessoa.com", ehAdmin: false, temSenha: false },
    }),
  );
  await page.goto("/login");
  await expect(page.getByRole("alert")).toContainText(/não é administrador/i);
  await expect(page.getByLabel("Senha")).toHaveCount(0);
});

test("admin sem senha é mandado ao time de desenvolvimento", async ({
  page,
}) => {
  await page.route("**/admin/auth/contexto", (rota) =>
    rota.fulfill({ json: { email: EMAIL, ehAdmin: true, temSenha: false } }),
  );
  await page.goto("/login");
  await expect(page.getByRole("alert")).toContainText(
    /entre em contato com o time de desenvolvimento/i,
  );
  await expect(page.getByLabel("Senha")).toHaveCount(0);
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts admin/e2e/login.spec.ts --project=chromium`
Expected: FAIL — a tela ainda pede email.

- [ ] **Step 5: Reescrever o cliente de API**

Em `web/admin/src/lib/api.ts`, trocar a interface `Usuario` por:

```ts
export interface ContextoAdmin {
  email: string;
  ehAdmin: boolean;
  temSenha: boolean;
}
```

Trocar o bloco `// ---- sessão ----` por:

```ts
  contexto: () => chamar<ContextoAdmin>("/admin/auth/contexto"),
  me: () => chamar<{ email: string }>("/admin/auth/me"),
  entrar: (senha: string) =>
    chamar<{ ok: true }>("/admin/auth/login", {
      method: "POST",
      body: json({ senha }),
    }),
  sair: () => chamar<{ ok: true }>("/admin/auth/logout", { method: "POST" }),
  trocarSenha: (senhaAtual: string, nova: string) =>
    chamar<{ ok: true }>("/admin/auth/senha", {
      method: "POST",
      body: json({ senhaAtual, nova }),
    }),
```

E envolver o `fetch` de `chamar` para tratar a expiração do Access:

```ts
const CHAVE_RECARGA = "recarga-access";

/**
 * Sessão do Access expirada devolve 302 para o IdP, e um fetch cross-origin
 * morre sem status — o painel só vê "failed to fetch" e pareceria fora do ar.
 * Recarregar transforma o caso numa navegação de topo, que o Access
 * redireciona de verdade.
 *
 * O carimbo evita laço quando quem caiu é o Worker: no máximo uma recarga por
 * minuto, e a falha seguinte vira mensagem na tela.
 */
function talvezRecarregar(): void {
  if (typeof window === "undefined") return;
  const agora = Date.now();
  const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) ?? 0);
  if (agora - ultima < 60_000) return;
  sessionStorage.setItem(CHAVE_RECARGA, String(agora));
  window.location.reload();
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(caminho, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : init?.body
            ? { "content-type": "application/json" }
            : {}),
        ...init?.headers,
      },
    });
  } catch (falha) {
    talvezRecarregar();
    throw falha;
  }

  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(res.status, corpo?.error ?? "erro_desconhecido");
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 6: Ajustar as mensagens**

Em `web/admin/src/lib/erros.ts`, no bloco `// sessão`: sai `captcha_failed` (o painel não tem mais Turnstile) e entram:

```ts
  // Não existe mais campo de email: o que pode estar errado é a senha.
  invalid_credentials: "Senha inválida.",
  weak_password: "A senha precisa ter pelo menos 12 caracteres.",
  senha_atual_incorreta: "Senha atual incorreta.",
```

- [ ] **Step 7: Ajustar a guarda de rota e a topbar**

`web/admin/src/lib/sessao.tsx`: `useSessao` passa a chamar `api.me()` (agora `/admin/auth/me`), guarda `{ email }` em vez de `Usuario`, e redireciona para `/login` em 401 **e** 403 — sem `?motivo=`, porque a tela de login descobre sozinha o que dizer pelo `/admin/auth/contexto`. Some a checagem `u.role !== "admin"`. O comentário do topo troca "o `role=admin` lido do D1 pelo Worker" por "as cinco checagens de `requireSessaoAdmin`".

`web/admin/src/componentes/Layout.tsx`: `const { carregando, admin } = useSessao();`, o `<span>` mostra `admin.email` (some o `usuario.name ?? …`), e entra um link antes do botão Sair:

```tsx
            <Link
              href="/senha"
              className="hidden sm:inline text-[15px] font-semibold text-txt-2"
            >
              Trocar senha
            </Link>
```

- [ ] **Step 8: Reescrever a tela de login**

Substituir `web/admin/src/app/login/page.tsx` inteiro:

```tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { api, type ContextoAdmin } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

/**
 * Três estados, decididos pelo servidor. Não há campo de email: a identidade
 * vem do token do Access e o Worker a lê de lá, então oferecer onde digitar
 * outro seria oferecer um controle que não controla nada.
 *
 * Sem Turnstile, ao contrário do login do aluno: esta tela só é alcançável
 * atrás do Access, que exige login no IdP com MFA — não há bot anônimo a
 * barrar (spec §6).
 */
export default function PaginaLogin() {
  const [contexto, setContexto] = useState<ContextoAdmin | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    api
      .contexto()
      .then((c) => {
        if (vivo) setContexto(c);
      })
      .catch((falha) => {
        if (vivo) setErro(mensagemDe(falha));
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.entrar(senha);
      router.replace("/");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  const pronto = contexto?.ehAdmin && contexto.temSenha;

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <Card className="w-full max-w-[420px] p-7 flex flex-col gap-5">
        <Image
          src="/logo.png"
          alt="Mais Aprovação Questões"
          width={200}
          height={76}
          className="h-14 w-auto self-center"
          priority
        />
        <h1 className="font-display text-xl font-bold text-center">
          Painel administrativo
        </h1>

        {contexto && (
          <p className="text-[13.5px] text-txt-2 text-center">
            Você entrou pelo Access como <strong>{contexto.email}</strong>.
          </p>
        )}

        {contexto && !contexto.ehAdmin && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            Este email não é administrador.
          </p>
        )}

        {contexto?.ehAdmin && !contexto.temSenha && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            Este email ainda não tem senha definida. Entre em contato com o time
            de desenvolvimento.
          </p>
        )}

        {pronto && (
          <form onSubmit={enviar} className="flex flex-col gap-4">
            <Campo rotulo="Senha" htmlFor="senha">
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                className={CONTROLE}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>

            {erro && (
              <p role="alert" className="text-[13.5px] font-semibold text-erro">
                {erro}
              </p>
            )}

            <Botao type="submit" carregando={enviando}>
              Entrar
            </Botao>
          </form>
        )}

        {/* Sair do painel não sai do Access — são sessões diferentes. */}
        <a
          href="/cdn-cgi/access/logout"
          className="text-[12.5px] text-txt-3 text-center"
        >
          Encerrar também a sessão do Access
        </a>
      </Card>
    </main>
  );
}
```

Saem junto: o `<Script>` do Turnstile, o `SITE_KEY`, o `declare global` do `window.turnstile`, o `useSearchParams` e o `Suspense` que existia só por causa dele.

- [ ] **Step 9: Ajustar os helpers de e2e**

Em `web/admin/e2e/entrar.ts`, tirar a linha do email de `entrar()` e reescrever o comentário de `aguardarFormularioVivo`:

```ts
/**
 * Espera o formulário estar de fato interativo antes de preencher.
 *
 * Preencher antes de o React hidratar faz a hidratação restaurar o input
 * controlado para "". O botão habilitado é o sinal certo porque ele só existe
 * depois que `/admin/auth/contexto` respondeu — o que implica React vivo e
 * estado carregado. O prazo é generoso porque a resposta vem do Worker.
 */
```

Em `web/admin/e2e/caminho-critico.spec.ts:8-20`, o login manual do primeiro teste perde a linha `getByLabel("Email")`.

- [ ] **Step 10: Rodar a suíte inteira**

```bash
cd api && npm run db:migrate:local
cd ../web && npm run typecheck && npm test
```

Expected: PASS nos dois navegadores. Diagnóstico se falhar: `forbidden` no login significa `ADMIN_EMAILS` errado no `.dev.vars`; `unauthorized` já no `/admin/auth/contexto` significa `ACCESS_DEV_EMAIL` ausente.

- [ ] **Step 11: Commit**

```bash
git add web/admin/src web/admin/e2e
git commit -m "feat(web): o painel deixa de perguntar quem você é — o Access já respondeu"
```

---

### Task 8: A tela de troca de senha

**Files:**
- Create: `web/admin/src/app/senha/page.tsx`
- Create: `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: `api.trocarSenha(senhaAtual, nova)` (Task 7), `POST /admin/auth/senha` (Task 4), `Layout` e `useSessao`.

- [ ] **Step 1: Escrever o e2e que falha**

Criar `web/admin/e2e/senha.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { SENHA } from "./credenciais.mjs";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

// Cada caso parte de uma senha conhecida: o primeiro que trocar a senha
// invalidaria os vizinhos se a semente não voltasse ao estado inicial.
test.beforeEach(semear);

test("a troca exige a senha atual", async ({ page }) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill("nao-e-essa-senha");
  await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await page.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.getByRole("alert")).toContainText(/senha atual incorreta/i);
});

test("a confirmação precisa bater, e isso nem chega no servidor", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await page.getByLabel("Confirme a nova senha").fill("outra-coisa-comprida");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.getByRole("alert")).toContainText(/não conferem/i);
});

test("senha nova curta é recusada", async ({ page }) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill("curta12345");
  await page.getByLabel("Confirme a nova senha").fill("curta12345");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.getByRole("alert")).toContainText(/12 caracteres/i);
});

test("trocada a senha, a nova entra e a antiga não", async ({ page }) => {
  const NOVA = "senha-nova-do-teste";
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await page.getByLabel("Confirme a nova senha").fill(NOVA);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByRole("status")).toContainText(/senha trocada/i);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    /senha inválida/i,
  );

  await page.getByLabel("Senha").fill(NOVA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts admin/e2e/senha.spec.ts --project=chromium`
Expected: FAIL — `/senha` é 404.

- [ ] **Step 3: Escrever a tela**

Criar `web/admin/src/app/senha/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

/**
 * Atrás do Access (o hostname inteiro está), atrás da sessão do painel e
 * atrás da senha atual — três provas. A terceira é a que impede que uma
 * sessão deixada aberta numa máquina destravada vire sequestro da conta.
 *
 * Não existe recuperação por email para admin: quem esquece a senha pede uma
 * nova pelo CLI (`npm run admin:senha`).
 */
export default function PaginaSenha() {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setPronto(false);

    // Conferência local: mandar duas senhas para o servidor comparar seria
    // uma ida à rede para descobrir o que já dá para saber aqui.
    if (nova !== confirmacao) {
      setErro("A nova senha e a confirmação não conferem.");
      return;
    }

    setEnviando(true);
    try {
      await api.trocarSenha(atual, nova);
      setPronto(true);
      setAtual("");
      setNova("");
      setConfirmacao("");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Layout>
      <Card className="max-w-[480px] p-7 flex flex-col gap-5">
        <h1 className="font-display text-xl font-bold">Trocar senha</h1>

        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo rotulo="Senha atual" htmlFor="atual">
            <input
              id="atual"
              type="password"
              autoComplete="current-password"
              required
              className={CONTROLE}
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Nova senha" htmlFor="nova">
            <input
              id="nova"
              type="password"
              autoComplete="new-password"
              required
              className={CONTROLE}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Confirme a nova senha" htmlFor="confirmacao">
            <input
              id="confirmacao"
              type="password"
              autoComplete="new-password"
              required
              className={CONTROLE}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </Campo>

          {erro && (
            <p role="alert" className="text-[13.5px] font-semibold text-erro">
              {erro}
            </p>
          )}
          {pronto && (
            <p role="status" className="text-[13.5px] font-semibold">
              Senha trocada.
            </p>
          )}

          <Botao type="submit" carregando={enviando}>
            Trocar senha
          </Botao>
        </form>
      </Card>
    </Layout>
  );
}
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS nos dois navegadores.

- [ ] **Step 5: Commit**

```bash
git add web/admin/src/app/senha web/admin/e2e/senha.spec.ts
git commit -m "feat(web): trocar a senha do painel deixa de exigir um terminal"
```

---

### Task 9: Documentação e comentários (regra 8)

Sem código de produção. É a tarefa que impede o repositório de continuar afirmando o contrário do que faz.

**Files:**
- Modify: `docs/especificacao-tecnica.md:318`
- Modify: `api/README.md:48,69`
- Modify: `web/README.md` (Setup, Rodar, Segurança)
- Modify: `docs/proxima-fase-pendencias.md`
- Modify: `docs/runbook-verificacao-hotmart.md:266`
- Modify: `docs/superpowers/specs/2026-07-06-fundacao-auth-design.md` (aviso no topo)
- Verify: `api/src/middleware/access.ts`, `api/src/app.ts`, `api/src/db/users.ts`, `web/admin/src/lib/sessao.tsx`

- [ ] **Step 1: Varrer o que ficou mentiroso**

```bash
grep -rn "role='admin'\|role=admin\|role: \"admin\"\|ADMIN_EMAILS\|nascido de uma compra\|primeiro admin" \
  docs/*.md api/README.md web/README.md
```

Anotar cada ocorrência. As de `docs/superpowers/plans/` e das specs anteriores **não** entram — são registro histórico (Step 5).

- [ ] **Step 2: Consertar os documentos vivos**

| Arquivo | O que dizer agora |
|---|---|
| `docs/especificacao-tecnica.md:318` | não existe mais `role`; admin é `ADMIN_EMAILS` ∩ `admins`, e o webhook não consulta allowlist nenhuma |
| `api/README.md:48` | a lista de vars ganha `ACCESS_DEV_EMAIL`; `ADMIN_EMAILS` deixa de ser "quem recebe `role=admin`" e passa a ser "quem pode ser admin, se tiver senha em `admins`" |
| `api/README.md` | seção nova documentando `npm run admin:senha` — uso, o `--local`, o `--remover`, e a frase de que é o único jeito de criar senha de admin |
| `web/README.md` (Setup) | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` sai do `.env.development.local` do painel; `.dev.vars` ganha `ACCESS_DEV_EMAIL` e `ADMIN_EMAILS` |
| `web/README.md` (Rodar) | "Entrar com `admin@dev.local` / senha" vira "entrar só com a senha — o email vem do `ACCESS_DEV_EMAIL`" |
| `web/README.md` (Segurança) | as duas camadas continuam, mas a segunda é `requireSessaoAdmin` e o email das duas é o mesmo, por decisão |
| `docs/runbook-verificacao-hotmart.md:266` | uma compra com email de admin cria conta de aluno como qualquer outra; apagá-la não tem mais relação com o painel |
| `docs/proxima-fase-pendencias.md` | estado: o login do admin saiu do fluxo do aluno; o que falta publicar; o ucode continua sendo o bloqueante |

- [ ] **Step 3: Conferir os comentários de código**

Os quatro já devem ter sido reescritos nas tarefas anteriores. Reler e confirmar que nenhum ainda afirma o antigo:

```bash
grep -n "NÃO identifica\|role" api/src/middleware/access.ts api/src/app.ts api/src/db/users.ts web/admin/src/lib/sessao.tsx
```

Expected: nenhuma linha afirmando que o email do Access não identifica o usuário, e nenhum `role` fora de atributo ARIA.

- [ ] **Step 4: Marcar a spec antiga**

No topo de `docs/superpowers/specs/2026-07-06-fundacao-auth-design.md`, logo abaixo do título:

```markdown
> **Superado em parte, 2026-08-18.** A identidade do admin descrita aqui
> (`role='admin'` em `users`, concedido na compra) foi substituída por
> [`2026-08-18-login-admin-design.md`](2026-08-18-login-admin-design.md). O
> resto do documento — auth do aluno, webhook, entitlement — continua valendo.
```

Nada mais é editado nos documentos históricos: eles registram o que foi decidido quando, e reescrevê-los apagaria o rastro.

- [ ] **Step 5: Commit**

```bash
git add docs api/README.md web/README.md
git commit -m "docs: o repositório para de afirmar que admin nasce de compra"
```

---

### Task 10: Runbook de publicação e configuração do Access

Termina com um checklist executável por uma pessoa — a parte manual do entregável.

**Files:**
- Modify: `docs/runbook-deploy-producao.md` (fase 8 — Access; fase 11 — primeiro admin; tabela de rotas; tabela de camadas)

- [ ] **Step 1: Reescrever a fase 11**

A seção "O primeiro admin — problema do ovo e da galinha" (`:748-765`) descrevia duas saídas, ambas passando por compra ou por `INSERT` manual. Substituir por:

```markdown
**O primeiro admin.** Não existe mais problema do ovo e da galinha: admin não
nasce de compra nenhuma. São dois passos, os dois manuais por decisão.

- [ ] O email está em `ADMIN_EMAILS` (`api/wrangler.jsonc`) e o Worker foi
      publicado depois disso. Sem publicar, a allowlist em produção é a antiga.
- [ ] `cd api && npm run admin:senha -- <email>` — pede a senha duas vezes, sem
      eco, e grava em `admins` no D1 remoto. Mínimo de 12 caracteres.
- [ ] Entrar em `https://admin.maisaprovacao.com.br/login`, passando **duas
      vezes** por identidade: o Access primeiro, a senha depois. A tela não
      pede email — ela mostra o que veio do token do Access.

Para rotacionar, o mesmo comando. Para revogar: tirar o email de
`ADMIN_EMAILS` e publicar (derruba a sessão na requisição seguinte), e depois
`npm run admin:senha -- <email> --remover` para não deixar senha órfã.
```

Na tabela de `:407-408`, a linha do painel passa a ser:

```markdown
| **Painel** | que você é *admin da aplicação* | email em `ADMIN_EMAILS` **e** senha em `admins`, criada pelo CLI |
```

- [ ] **Step 2: Escrever a subseção do Access**

Acrescentar à fase 8 (Cloudflare Access), depois do que já existe sobre a política:

```markdown
### Configuração da aplicação Access

**Zero Trust → Access controls → Applications →** aplicação de
`admin.maisaprovacao.com.br` **→ Configure**. Só um campo sai do padrão.

| Campo | Valor | Por quê |
|---|---|---|
| **Session Duration** | 24 horas (padrão) | O Worker revalida o JWT a cada requisição; o que limita o estrago de um token roubado é a revalidação, não a validade. Com a sessão do painel em 12 h, dá no máximo duas digitações de senha e uma ida ao IdP por dia. |
| **HTTP Only** | ON (padrão) | Nada lê o `CF_Authorization` por JavaScript — o Worker lê o header `Cf-Access-Jwt-Assertion`. |
| **SameSite Attribute** | Lax | `Strict` causa `ERR_TOO_MANY_REDIRECTS`, pela própria documentação da Cloudflare. |
| **Eager redirect cookie** | ON (padrão) | Só afeta aplicação multi-domínio; aqui há um hostname só e a cadeia de redirects tem comprimento um. |
| **Enable Binding Cookie** | **ON** — única mudança | Emite o `CF_Binding`, que amarra o `CF_Authorization` àquele navegador: cookie roubado não é reutilizável. As exceções documentadas (SSH/RDP, Zaraz, cliente WARP) não se aplicam. |

- [ ] Os cinco campos conferidos, o *Binding Cookie* ligado e **Save**.
- [ ] **Global session duration** (Access settings) deixado como está — a
      hierarquia é global > aplicação > política, e mexer no global afetaria
      qualquer aplicação futura.
- [ ] **401 Response for Service Auth policies** ignorado: não usamos service
      tokens.

> **A política do Access e o `ADMIN_EMAILS` são listas separadas e precisam ser
> mantidas em sincronia.** A política é o portão externo (quem alcança o
> hostname); o `ADMIN_EMAILS` é o interno (quem é admin). Email só na política
> vê a tela dizendo que não é administrador; email só no `ADMIN_EMAILS` não
> chega nem lá.

> **Não adicionar hostname a esta aplicação Access.** Ela cobre `admin.` e só.
> Incluir `app.` quebraria o webhook da Hotmart, que precisa ser alcançável sem
> identidade; incluir muitos faria a cadeia do *Eager redirect cookie* virar
> loop de login.

Outros cookies que o Access emite e que não configuramos, para ninguém os
confundir com cookie da aplicação ao ler um `wrangler tail`: `CF_Session`
(CSRF no team domain, 4 h), `CF_AppSession` (CSRF por aplicação, 24 h) e
`CF_Device` (anti-abuso de PIN e MFA, 30 dias).
```

- [ ] **Step 3: Escrever a ordem de publicação**

Acrescentar à fase 13, ou como seção própria se ela já tiver dono:

```markdown
### Publicar a separação do login do admin

A ordem existe porque uma migração é destrutiva e o Worker em produção lê a
coluna que ela apaga.

- [ ] 1. `cd api && npx wrangler d1 migrations apply mais-aprovacao-db --remote`
      aplicando **só** a migração de `CREATE TABLE admins`. `wrangler deploy`
      não aplica migração — é passo separado.
- [ ] 2. `npm run deploy` do Worker.
- [ ] 3. `npm run admin:senha -- <email>` para cada um dos três emails.
- [ ] 4. Deploy do Pages com o painel novo.
- [ ] 5. Aplicar a migração de `DROP COLUMN role`, agora que ninguém a lê.
- [ ] 6. Configuração do Access (subseção da fase 8).
- [ ] 7. Conferência: janela anônima → IdP → a tela mostra o email certo;
      uma identidade fora do `ADMIN_EMAILS` vê "não é administrador";
      `npm run admin:senha -- <email> --remover` derruba a sessão viva na
      requisição seguinte (e depois recriar a senha).

Entre 2 e 4 o painel publicado chama rotas que deixaram de existir: janela de
minutos, sem usuário fora das três pessoas. Inverter 2 e 4 é o mesmo erro com
mais exposição.
```

- [ ] **Step 4: Atualizar a tabela de rotas e a de camadas**

Em `:554-557`, a tabela de Worker Routes não muda (o `/admin/*` já cobre `/admin/auth/*`), mas ganha uma nota:

```markdown
> `/admin/auth/*` é servido pela mesma Worker Route `/admin/*`. É de propósito:
> o login do painel fica dentro do prefixo coberto pelo Access, e por
> construção inalcançável de `app.<domínio>`, onde não há rota que o case.
```

Em `:286`, onde o runbook explica a autenticação dupla, acrescentar que as duas camadas agora concordam no email — e por quê (spec §5).

- [ ] **Step 5: Conferir que o runbook não contradiz mais nada**

```bash
grep -rn "role\|nascido de uma compra\|Turnstile" docs/runbook-deploy-producao.md
```

Expected: nenhuma menção a `role`; o Turnstile aparece só no contexto do login do aluno e da fase 13 (chaves de produção), nunca do painel.

- [ ] **Step 6: Commit**

```bash
git add docs/runbook-deploy-producao.md
git commit -m "docs(runbook): o primeiro admin vira dois comandos, e o Access ganha checklist"
```

---

## Ordem, e o que cada tarefa entrega

| # | Tarefa | Entrega verificável |
|---|---|---|
| 1 | Tabela `admins` | `npm test` verde, migração aditiva aplicada |
| 2 | `emailDoAccess` | o email sai do JWT; bypass sem email é 401 |
| 3 | Sessão do painel | cookie e JWT próprios, tokens não intercambiáveis |
| 4 | Rotas `/admin/auth/*` | login funciona ponta a ponta pela API |
| 5 | `role` sai | nenhuma coluna do banco concede privilégio |
| 6 | CLI | senha criada de um terminal, sem passar por `argv` |
| 7 | Painel | suíte e2e verde nos dois navegadores |
| 8 | Troca de senha | e2e da troca verde |
| 9 | Documentação | nenhum documento vivo afirma o antigo |
| 10 | Runbook e Access | checklist executável pelo dono |

As tarefas 1 a 5 são sequenciais — cada uma compila em cima da anterior. A 6 depende só da 1. A 7 depende da 4; a 8, da 7. As 9 e 10 dependem de tudo, e são as únicas que podem correr em paralelo entre si.
