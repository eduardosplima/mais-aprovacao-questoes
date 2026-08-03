import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../config/env";

/**
 * Primeira das duas camadas de `/admin/*`: o JWT que o Cloudflare Access
 * injeta na borda depois de autenticar a pessoa no IdP (Google/GitHub, com
 * MFA). A segunda camada é `requireSession` + `requireAdmin`, que leem o D1.
 *
 * As duas são independentes de propósito: o email deste JWT NÃO identifica o
 * usuário na aplicação. Se identificasse, o Access viraria fonte de identidade
 * e as camadas deixariam de ser duas.
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

export const requireAccess = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    // Fail-closed: só a string exata "true" abre, e a var só existe em
    // `.dev.vars`. Em `wrangler dev` nada passa pela borda da Cloudflare, então
    // o header não existe; em produção a var não existe e o header é exigido.
    if (c.env.ACCESS_DEV_BYPASS === "true") {
      await next();
      return;
    }

    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    try {
      await jwtVerify(token, jwksFor(issuer), {
        issuer,
        audience: c.env.ACCESS_AUD,
      });
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  },
);
