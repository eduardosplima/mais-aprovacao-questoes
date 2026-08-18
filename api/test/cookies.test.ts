import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  setSessionCookie,
  getSessionCookie,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} from "../src/lib/cookies";

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

  it("sessão de admin: seta com flags de segurança e Max-Age de 12 horas", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setAdminSessionCookie(c, "jwt-token-admin");
      return c.text("ok");
    });

    const res = await app.request("/set");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sessao_admin=jwt-token-admin");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=43200");
  });

  it("sessão de admin: limpar zera o valor", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearAdminSessionCookie(c);
      return c.text("ok");
    });

    const res = await app.request("/clear");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sessao_admin=;");
  });
});
