import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import { getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { findAdmin } from "../db/admins";
import { getAdminSessionCookie } from "../lib/cookies";
import { verifyAdminSession } from "../lib/jwt";
import { emailDoAccess } from "./access";

/**
 * Segunda camada de `/admin/*`, e cinco checagens a cada requisição:
 *
 * 1. cookie presente;
 * 2. JWT válido e do tipo certo;
 * 3. o email da sessão é o mesmo do token do Access;
 * 4. o email está em ADMIN_EMAILS;
 * 5. existe senha cadastrada.
 *
 * As três últimas são lidas a cada requisição de propósito: tirar um email da
 * allowlist e publicar, ou apagar a linha de `admins`, derruba a sessão viva
 * na requisição seguinte, sem lista de revogação. É o mesmo princípio de
 * `loadEntitlement`, que deriva o tier em vez de carregá-lo no JWT.
 *
 * A checagem 3 é a regra que amarra o painel ao Access: uma sessão obtida por
 * uma pessoa não vale com o token de outra.
 */
export const requireSessaoAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>(async (c, next) => {
  const token = getAdminSessionCookie(c);
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const email = await verifyAdminSession(token, c.env.JWT_SECRET);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  if (email !== emailDoAccess(c)) return c.json({ error: "unauthorized" }, 401);

  if (!getAdminEmails(c.env).includes(email)) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!(await findAdmin(getDb(c.env), email))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await next();
});
