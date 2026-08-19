import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env";
import { getAdminEmails } from "../../config/env";
import { getDb } from "../../db/client";
import { findAdmin, upsertAdmin } from "../../db/admins";
import { hashPassword, verifyPassword } from "../../lib/password";
import { signAdminSession } from "../../lib/jwt";
import { setAdminSessionCookie, clearAdminSessionCookie } from "../../lib/cookies";
import { emailDoAccess } from "../../middleware/access";
import { requireSessaoAdmin } from "../../middleware/adminSession";

/** Mais que os 8 do aluno: são três pessoas e a senha é digitada raramente. */
export const MIN_SENHA_ADMIN = 12;

export const adminAuth = new Hono<{
  Bindings: Env;
  Variables: { accessEmail: string };
}>();

/**
 * O que a tela de login precisa saber para escolher entre os três estados.
 * Vive atrás do Access, então quem o alcança já passou pelo IdP — não há
 * enumeração possível aqui: o email não é escolhido por quem chama.
 */
adminAuth.get("/contexto", async (c) => {
  const email = emailDoAccess(c);
  const ehAdmin = getAdminEmails(c.env).includes(email);
  const temSenha = ehAdmin && !!(await findAdmin(getDb(c.env), email));
  return c.json({ email, ehAdmin, temSenha });
});

const loginSchema = z.object({ senha: z.string() });

adminAuth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  // O email NUNCA vem do corpo. Um `email` enviado junto é ignorado pelo
  // schema e não tem para onde ir.
  const email = emailDoAccess(c);
  if (!getAdminEmails(c.env).includes(email)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const admin = await findAdmin(getDb(c.env), email);
  // Sem hash descartável, ao contrário de /auth/login: lá o tempo de resposta
  // seria um oráculo de existência de conta; aqui quem chama já passou pelo
  // IdP, o email é o dele, e /admin/auth/contexto informa `temSenha` de
  // propósito. Não há o que enumerar.
  if (!admin || !(await verifyPassword(parsed.data.senha, admin.passwordHash))) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  setAdminSessionCookie(c, await signAdminSession(email, c.env.JWT_SECRET));
  return c.json({ ok: true });
});

/** Encerra só a sessão do painel — a do Access é outra e continua viva. */
adminAuth.post("/logout", (c) => {
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

adminAuth.get("/me", requireSessaoAdmin, (c) =>
  c.json({ email: emailDoAccess(c) }),
);

const senhaSchema = z.object({ senhaAtual: z.string(), nova: z.string() });

adminAuth.post("/senha", requireSessaoAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = senhaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  if (parsed.data.nova.length < MIN_SENHA_ADMIN) {
    return c.json({ error: "weak_password" }, 400);
  }

  const email = emailDoAccess(c);
  const admin = await findAdmin(getDb(c.env), email);
  // requireSessaoAdmin já garantiu que existe; o `!admin` é para o TypeScript.
  if (!admin || !(await verifyPassword(parsed.data.senhaAtual, admin.passwordHash))) {
    return c.json({ error: "senha_atual_incorreta" }, 400);
  }

  await upsertAdmin(getDb(c.env), email, await hashPassword(parsed.data.nova));
  // Reemite a sessão: o `updated_at` que acabou de ser carimbado invalida
  // toda sessão anterior à troca (checagem 6 de requireSessaoAdmin) — a
  // roubada e também esta. Sem o cookie novo, trocar a própria senha
  // deslogaria quem trocou.
  setAdminSessionCookie(c, await signAdminSession(email, c.env.JWT_SECRET));
  return c.json({ ok: true });
});
