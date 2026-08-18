import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { Env } from "../src/config/env";
import { envWith } from "./helpers";
import {
  requireAccess,
  emailDoAccess,
  __resetJwksCache,
} from "../src/middleware/access";

const TEAM = "equipe-test.cloudflareaccess.com";
const AUD = "aud-de-teste";

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/admin/ping", requireAccess, (c) => c.text("ok"));
  return app;
}

/** Gera um par de chaves e stuba o endpoint de certs do Access. */
async function withJwks() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("fetch inesperado: " + String(input));
    }),
  );
  return privateKey;
}

async function token(
  privateKey: CryptoKey,
  over: { iss?: string; aud?: string; email?: string } = {},
): Promise<string> {
  return new SignJWT(over.email ? { email: over.email } : {})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(over.iss ?? `https://${TEAM}`)
    .setAudience(over.aud ?? AUD)
    .setExpirationTime("5m")
    .sign(privateKey);
}

const base = () =>
  envWith({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_DEV_BYPASS: "" });

describe("requireAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetJwksCache();
  });

  it("401 sem o header", async () => {
    const res = await buildApp().request("/admin/ping", {}, base());
    expect(res.status).toBe(401);
  });

  it("401 com token de assinatura desconhecida", async () => {
    await withJwks();
    const outro = await generateKeyPair("RS256", { extractable: true });
    const bad = await token(outro.privateKey);
    const res = await buildApp().request(
      "/admin/ping",
      { headers: { "cf-access-jwt-assertion": bad } },
      base(),
    );
    expect(res.status).toBe(401);
  });

  it("401 quando o aud não é o da aplicação", async () => {
    const key = await withJwks();
    const res = await buildApp().request(
      "/admin/ping",
      { headers: { "cf-access-jwt-assertion": await token(key, { aud: "outro" }) } },
      base(),
    );
    expect(res.status).toBe(401);
  });

  it("401 quando o iss não é o do time", async () => {
    const key = await withJwks();
    const res = await buildApp().request(
      "/admin/ping",
      {
        headers: {
          "cf-access-jwt-assertion": await token(key, {
            iss: "https://invasor.cloudflareaccess.com",
          }),
        },
      },
      base(),
    );
    expect(res.status).toBe(401);
  });

  it("200 com token válido", async () => {
    const key = await withJwks();
    const res = await buildApp().request(
      "/admin/ping",
      {
        headers: {
          "cf-access-jwt-assertion": await token(key, { email: "user@test.com" }),
        },
      },
      base(),
    );
    expect(res.status).toBe(200);
  });

  it("o bypass de dev dispensa o header", async () => {
    const res = await buildApp().request(
      "/admin/ping",
      {},
      envWith({
        ACCESS_TEAM_DOMAIN: TEAM,
        ACCESS_AUD: AUD,
        ACCESS_DEV_BYPASS: "true",
        ACCESS_DEV_EMAIL: "admin@dev.local",
      }),
    );
    expect(res.status).toBe(200);
  });

  // Fail-closed: só a string exata "true" abre.
  it.each(["", "false", "1", "TRUE", undefined])(
    "não faz bypass com ACCESS_DEV_BYPASS=%j",
    async (value) => {
      const res = await buildApp().request(
        "/admin/ping",
        {},
        envWith({
          ACCESS_TEAM_DOMAIN: TEAM,
          ACCESS_AUD: AUD,
          ACCESS_DEV_BYPASS: value,
        }),
      );
      expect(res.status).toBe(401);
    },
  );
});

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
