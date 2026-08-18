import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";
import { webhooks } from "./webhooks/hotmart";
import { adminAuth } from "./routes/admin/auth";
import { adminTaxonomy } from "./routes/admin/taxonomy";
import { adminQuestions } from "./routes/admin/questions";
import { adminMedia } from "./routes/admin/media";
import { media } from "./routes/media";
import { requireAccess } from "./middleware/access";
import { requireSessaoAdmin } from "./middleware/adminSession";

export const app = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);
// Fora do Access de propósito: quem chama é a Hotmart, que não tem identidade
// no nosso IdP.
app.route("/webhooks", webhooks);

// Só alcançável em desenvolvimento: nenhuma Worker Route casa /media/*.
// Ver o comentário em routes/media.ts.
app.route("/media", media);

/**
 * Duas camadas independentes, nesta ordem:
 * 1. requireAccess — o JWT que o Cloudflare Access injeta na borda (identidade
 *    + MFA no IdP). Barra antes de qualquer consulta ao banco, e é quem grava
 *    o email que `emailDoAccess` devolve.
 * 2. requireSessaoAdmin — a sessão do painel, com a senha própria.
 *
 * `/admin/auth/*` fica só sob a camada 1, por definição: é onde a sessão da
 * camada 2 nasce. As rotas de conteúdo ficam sob as duas, agrupadas em
 * `adminProtegido` — um sub-router em vez de `app.use("/admin/...")` porque
 * `/admin/taxonomy/*` não casa `/admin/taxonomy`, e é exatamente nesse
 * caminho sem barra que mora o `GET` da listagem.
 *
 * A ordem de registro importa: `adminAuth` é montado antes, e seus handlers
 * respondem sem passar pelo `use("*")` de `adminProtegido`. Os testes de
 * `admin-guards.test.ts` prendem esse comportamento.
 */
app.use("/admin/*", requireAccess);
app.route("/admin/auth", adminAuth);

const adminProtegido = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();
adminProtegido.use("*", requireSessaoAdmin);
adminProtegido.route("/taxonomy", adminTaxonomy);
adminProtegido.route("/questions", adminQuestions);
adminProtegido.route("/media", adminMedia);
app.route("/admin", adminProtegido);

export default app;
