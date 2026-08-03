import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { Env } from "../src/config/env";
import { envWith } from "./helpers";
import { requireAccess, __resetJwksCache } from "../src/middleware/access";

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
  over: { iss?: string; aud?: string } = {},
): Promise<string> {
  return new SignJWT({})
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
      { headers: { "cf-access-jwt-assertion": await token(key) } },
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
