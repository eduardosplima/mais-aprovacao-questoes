import { Hono } from "hono";
import type { Env } from "./config/env";
import type { Entitlement } from "./db/users";
import { auth } from "./routes/auth";
import { webhooks } from "./webhooks/hotmart";
import { adminTaxonomy } from "./routes/admin/taxonomy";
import { adminQuestions } from "./routes/admin/questions";
import { adminMedia } from "./routes/admin/media";
import { requireAccess } from "./middleware/access";
import { requireSession } from "./middleware/session";
import { requireAdmin } from "./middleware/rbac";

export const app = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);
// Fora do Access de propósito: quem chama é a Hotmart, que não tem identidade
// no nosso IdP.
app.route("/webhooks", webhooks);

/**
 * Duas camadas independentes, nesta ordem:
 * 1. requireAccess — o JWT que o Cloudflare Access injeta na borda (identidade
 *    + MFA no IdP). Barra antes de qualquer consulta ao banco.
 * 2. requireSession + requireAdmin — sessão da aplicação e `role` lido do D1.
 *
 * Nenhuma confia na outra: o email do JWT do Access não identifica o usuário.
 */
app.use("/admin/*", requireAccess, requireSession, requireAdmin);
app.route("/admin/taxonomy", adminTaxonomy);
app.route("/admin/questions", adminQuestions);
app.route("/admin/media", adminMedia);

export default app;
