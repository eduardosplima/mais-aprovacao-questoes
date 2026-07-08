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
  const id = await upsertUser(db, { hotmartUserId: `h-${email}`, email }, [
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
