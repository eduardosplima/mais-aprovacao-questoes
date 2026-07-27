import { Hono } from "hono";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { clearSessionCookie } from "../lib/cookies";
import { requireSession } from "../middleware/session";

export const auth = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

// `name` entra na resposta na Task 4, junto com o campo em `Entitlement`.
auth.get("/me", requireSession, (c) => {
  const ent = c.get("entitlement");
  return c.json({
    id: ent.userId,
    email: ent.email,
    role: ent.role,
    tier: ent.tier,
  });
});

auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});
