/// <reference types="vite/client" />
import wranglerConfigRaw from "../wrangler.jsonc?raw";
import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { app } from "../src/app";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase } from "../src/db/users";
import { signSession } from "../src/lib/jwt";
import { envWith } from "./helpers";
import { __resetJwksCache } from "../src/middleware/access";

/**
 * Remove comentários `//` e `/* *​/` de um JSONC, respeitando strings — uma
 * troca ingênua por regex de linha cortaria `"https://…"` no meio, já que o
 * `//` de dentro da string não é comentário nenhum.
 */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next;
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

const TEAM = "equipe-test.cloudflareaccess.com";
const AUD = "aud-de-teste";

async function accessToken(): Promise<string> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k-guards", alg: "RS256" };
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
  // A partir da Task 2, requireAccess barra qualquer JWT sem email — este
  // helper não testa identidade do Access, só a camada de sessão/D1 abaixo
  // dele, então o valor em si é irrelevante.
  return new SignJWT({ email: "access@test.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k-guards" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function sessionCookie(email: string): Promise<string> {
  const id = await upsertUserFromPurchase(
    getDb(env),
    { email, name: null, documentHash: null },
    ["admin@test.com"],
  );
  return `session=${await signSession(id, env.JWT_SECRET)}`;
}

/** Bypass desligado: é assim que produção se comporta. */
const prod = () =>
  envWith({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_DEV_BYPASS: "" });

describe("guardas de /admin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetJwksCache();
  });

  it("401 sem nada", async () => {
    const res = await app.request("/admin/taxonomy?kind=banca", {}, prod());
    expect(res.status).toBe(401);
  });

  // A camada da borda não substitui a da aplicação.
  it("401 com Access válido mas sem sessão", async () => {
    const token = await accessToken();
    const res = await app.request(
      "/admin/taxonomy?kind=banca",
      { headers: { "cf-access-jwt-assertion": token } },
      prod(),
    );
    expect(res.status).toBe(401);
  });

  // Nem a da aplicação substitui a da borda.
  it("401 com sessão de admin mas sem Access", async () => {
    const cookie = await sessionCookie("admin@test.com");
    const res = await app.request(
      "/admin/taxonomy?kind=banca",
      { headers: { cookie } },
      prod(),
    );
    expect(res.status).toBe(401);
  });

  it("403 com Access válido e sessão de usuário comum", async () => {
    const token = await accessToken();
    const cookie = await sessionCookie("comum-admin@test.com");
    const res = await app.request(
      "/admin/taxonomy?kind=banca",
      { headers: { "cf-access-jwt-assertion": token, cookie } },
      prod(),
    );
    expect(res.status).toBe(403);
  });

  it("200 com Access válido e sessão de admin", async () => {
    const token = await accessToken();
    const cookie = await sessionCookie("admin@test.com");
    const res = await app.request(
      "/admin/taxonomy?kind=banca",
      { headers: { "cf-access-jwt-assertion": token, cookie } },
      prod(),
    );
    expect(res.status).toBe(200);
  });

  // /admin/media tem teste dedicado logo abaixo, porque a rota espera POST
  // com FormData em vez de GET — não dá para cobrir as três no mesmo loop
  // sem perder a asserção de 200 nas outras duas.
  it("as rotas de taxonomy e questions estão montadas", async () => {
    const token = await accessToken();
    const cookie = await sessionCookie("admin@test.com");
    const headers = { "cf-access-jwt-assertion": token, cookie };
    for (const path of ["/admin/taxonomy?kind=banca", "/admin/questions"]) {
      const res = await app.request(path, { headers }, prod());
      expect(res.status).toBe(200);
    }
  });

  // /admin/media é a rota mais nova, a mais fácil de esquecer num mount
  // futuro fora do bloco `app.use("/admin/*", ...)`. Sessão de admin válida
  // mas sem Access precisa continuar barrando aqui, do mesmo jeito que barra
  // em /admin/taxonomy — senão a proteção que existe hoje deixaria de ser
  // pega por regressão.
  it("401 em /admin/media com sessão de admin mas sem Access", async () => {
    const cookie = await sessionCookie("admin@test.com");
    const res = await app.request(
      "/admin/media",
      { method: "POST", headers: { cookie }, body: new FormData() },
      prod(),
    );
    expect(res.status).toBe(401);
  });

  // O webhook vem da Hotmart e não pode ficar atrás de identidade. Envia o
  // hottok válido para que um eventual 401 só possa vir do Access — o próprio
  // webhook já barra por hottok ausente/errado, o que não é o que este teste
  // verifica.
  it("o webhook segue fora do Access", async () => {
    const res = await app.request(
      "/webhooks/hotmart",
      {
        method: "POST",
        headers: { "x-hotmart-hottok": "test-hottok" },
        body: "{}",
      },
      prod(),
    );
    expect(res.status).not.toBe(401);
  });

  it("/health segue público", async () => {
    const res = await app.request("/health", {}, prod());
    expect(res.status).toBe(200);
  });
});

// A camada de bypass só existe para dev local (ver middleware/access.ts).
// Nenhum teste de guarda pega uma regressão que a ligasse em produção de
// verdade — todos injetam a var via envWith. Quem protege é este teste, lendo
// a configuração que o Worker de produção de fato usa.
describe("configuração de produção", () => {
  it("a var de bypass não existe no bloco vars de wrangler.jsonc", () => {
    const config = JSON.parse(stripJsonComments(wranglerConfigRaw)) as {
      vars?: Record<string, unknown>;
    };
    expect(config.vars).not.toHaveProperty("ACCESS_DEV_BYPASS");
  });
});
