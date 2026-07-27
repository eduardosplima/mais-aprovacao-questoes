import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { getDb } from "../db/client";
import { setPasswordHash } from "../db/users";
import { consumeToken } from "../db/authTokens";
import { hashPassword } from "../lib/password";
import { signSession } from "../lib/jwt";
import { setSessionCookie, clearSessionCookie } from "../lib/cookies";
import { requireSession } from "../middleware/session";

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
