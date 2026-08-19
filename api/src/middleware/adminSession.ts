import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import { getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { findAdmin } from "../db/admins";
import { getAdminSessionCookie } from "../lib/cookies";
import { verifyAdminSession } from "../lib/jwt";
import { emailDoAccess } from "./access";

/**
 * Segunda camada de `/admin/*`, e seis checagens a cada requisição:
 *
 * 1. cookie presente;
 * 2. JWT válido e do tipo certo;
 * 3. o email da sessão é o mesmo do token do Access;
 * 4. o email está em ADMIN_EMAILS;
 * 5. existe senha cadastrada;
 * 6. a sessão é posterior à última troca de senha.
 *
 * As quatro últimas são lidas a cada requisição de propósito: tirar um email
 * da allowlist e publicar, ou apagar a linha de `admins`, derruba a sessão
 * viva na requisição seguinte, sem lista de revogação. É o mesmo princípio de
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

  const sessao = await verifyAdminSession(token, c.env.JWT_SECRET);
  if (!sessao) return c.json({ error: "unauthorized" }, 401);
  const { email, iat } = sessao;
  if (email !== emailDoAccess(c)) return c.json({ error: "unauthorized" }, 401);

  if (!getAdminEmails(c.env).includes(email)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const admin = await findAdmin(getDb(c.env), email);
  if (!admin) {
    return c.json({ error: "forbidden" }, 403);
  }

  // Checagem 6: trocar a senha é o que expulsa quem roubou o cookie. Sem
  // isto, a sessão furtada continuaria valendo as 12 horas inteiras depois da
  // troca — e o remédio que a tela de senha promete não seria remédio nenhum.
  // Vale também para o `npm run admin:senha`, que carimba o mesmo
  // `updated_at`: o CLI passa a revogar sessões vivas, que é o caminho de
  // emergência do runbook.
  //
  // A comparação é em SEGUNDOS porque o `iat` do JWT é em segundos: converter
  // o `updated_at` para milissegundos recusaria o cookie emitido no mesmo
  // segundo da troca — inclusive o novo, que POST /admin/auth/senha reemite
  // logo depois de gravar.
  if (iat < Math.floor(admin.updatedAt.getTime() / 1000)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
});
