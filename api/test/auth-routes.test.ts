import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/index";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";

// `fetchMock` de cloudflare:test foi removido (pool-workers >=0.13.0);
// mockamos globalThis.fetch e roteamos pela URL.
afterEach(() => {
  vi.unstubAllGlobals();
});

function cookieFrom(res: Response, name: string): string | null {
  // Multiple Set-Cookie headers are joined by `res.headers.get("set-cookie")`
  // using ", " (comma+space), which is ambiguous with commas inside cookie
  // attributes. Use getSetCookie() to read each Set-Cookie value untouched.
  // getSetCookie() exists at runtime (Workers/undici Headers) but isn't in the
  // default @cloudflare/workers-types Headers type, so we cast at this one site.
  const all = (
    res.headers as unknown as { getSetCookie(): string[] }
  ).getSetCookie();
  const m = all.find((p) => p.startsWith(name + "="));
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

    // 2. stub das chamadas Hotmart (roteia por URL)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u === env.HOTMART_TOKEN_URL) {
          return new Response(JSON.stringify({ access_token: "AT" }), {
            status: 200,
          });
        }
        if (u === env.HOTMART_USERINFO_URL) {
          return new Response(
            JSON.stringify({ id: 42, email: "novo@test.com" }),
            { status: 200 },
          );
        }
        throw new Error("fetch inesperado: " + u);
      }),
    );

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
