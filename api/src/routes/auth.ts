import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { getDb } from "../db/client";
import { setPasswordHash, findUserByEmail } from "../db/users";
import { consumeToken } from "../db/authTokens";
import { hashPassword, verifyPassword } from "../lib/password";
import { signSession } from "../lib/jwt";
import { setSessionCookie, clearSessionCookie } from "../lib/cookies";
import { requireSession } from "../middleware/session";
import { verifyTurnstile } from "../lib/turnstile";
import { normalizeEmail } from "../lib/hmac";

export const auth = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

auth.get("/me", requireSession, (c) => {
  const ent = c.get("entitlement");
  return c.json({
    id: ent.userId,
    email: ent.email,
    name: ent.name,
    role: ent.role,
    tier: ent.tier,
  });
});

auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/**
 * Hash descartável, usado quando o email não tem conta ou nunca definiu senha.
 * Sem ele, o caminho "usuário inexistente" retornaria sem rodar PBKDF2 e o
 * tempo de resposta viraria um oráculo de existência de conta — anulando a
 * resposta genérica. Gerado com hashPassword("dummy") uma vez.
 */
const DUMMY_HASH =
  "pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string(),
  turnstileToken: z.string().optional(),
});

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const captchaOk = await verifyTurnstile(
    c.env,
    parsed.data.turnstileToken ?? "",
    c.req.header("cf-connecting-ip"),
  );
  if (!captchaOk) return c.json({ error: "captcha_failed" }, 403);

  const email = normalizeEmail(parsed.data.email);
  const user = await findUserByEmail(getDb(c.env), email);

  // Sempre roda o PBKDF2, exista o usuário ou não.
  const ok = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!ok || !user || !user.passwordHash) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  setSessionCookie(c, await signSession(user.id, c.env.JWT_SECRET));
  return c.json({ ok: true });
});

/** Recomendação NIST atual: comprimento, sem regras de composição. */
export const MIN_PASSWORD_LENGTH = 8;

const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string(),
});

auth.post("/set-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  // Validar a senha ANTES de consumir o token: senha curta não pode queimar o
  // link do aluno e obrigá-lo a pedir outro.
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: "weak_password" }, 400);
  }

  const db = getDb(c.env);
  const userId = await consumeToken(db, parsed.data.token);
  if (!userId) return c.json({ error: "invalid_token" }, 400);

  await setPasswordHash(db, userId, await hashPassword(parsed.data.password));
  setSessionCookie(c, await signSession(userId, c.env.JWT_SECRET));

  return c.json({ ok: true });
});
