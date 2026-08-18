import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context } from "hono";
import type { Env } from "../config/env";
import { normalizeEmail } from "../lib/hmac";

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

/**
 * O JWKS é cacheado por issuer. `createRemoteJWKSet` guarda as chaves e só
 * refaz o fetch quando encontra um `kid` desconhecido — recriá-lo a cada
 * request anularia esse cache e faria uma ida à rede por requisição.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(issuer: string) {
  let set = jwksCache.get(issuer);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, set);
  }
  return set;
}

/**
 * Só para os testes. Cada caso gera um par de chaves novo sob o mesmo issuer;
 * sem limpar o cache, o segundo caso em diante validaria contra a chave do
 * primeiro — e "aud errado" passaria por falha de assinatura, não de audiência.
 */
export function __resetJwksCache(): void {
  jwksCache.clear();
}

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
