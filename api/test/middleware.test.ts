import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/config/env";
import type { Entitlement } from "../src/db/users";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase } from "../src/db/users";
import { signSession } from "../src/lib/jwt";
import { requireSession } from "../src/middleware/session";

type App = { Bindings: Env; Variables: { entitlement: Entitlement } };

function buildApp() {
  const app = new Hono<App>();
  app.get("/protegido", requireSession, (c) =>
    c.json(c.get("entitlement")),
  );
  return app;
}

async function sessionCookieFor(email: string): Promise<string> {
  const id = await upsertUserFromPurchase(
    getDb(env),
    { email, name: null, documentHash: null },
    ["admin@test.com"],
  );
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
    expect(((await res.json()) as { email: unknown }).email).toBe("m1@test.com");
  });
});
