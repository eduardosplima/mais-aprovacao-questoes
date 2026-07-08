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
    app.get("/get", (c) => c.text(getSessionCookie(c) ?? "none"));

    const res = await app.request("/set");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=jwt-token");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const res2 = await app.request("/get", {
      headers: { cookie: "session=jwt-token" },
    });
    expect(await res2.text()).toBe("jwt-token");
  });

  it("state: assina e valida; rejeita cookie adulterado", async () => {
    const app = new Hono();
    app.get("/set", async (c) => {
      await setStateCookie(c, "abc123", KEY);
      return c.text("ok");
    });
    app.get("/get", async (c) => {
      const v = await getStateCookie(c, KEY);
      return c.json({ v });
    });

    const res = await app.request("/set");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toContain("oauth_state=");

    const ok = await app.request("/get", { headers: { cookie } });
    expect(((await ok.json()) as { v: unknown }).v).toBe("abc123");

    const tampered = await app.request("/get", {
      headers: { cookie: cookie + "x" },
    });
    // Hono rejeita a assinatura inválida (retorna false ou undefined,
    // nunca o valor original) — ambos são tratados como state inválido.
    const v = ((await tampered.json()) as { v: unknown }).v;
    expect(v).not.toBe("abc123");
    expect(v).toBeFalsy();
  });
});
