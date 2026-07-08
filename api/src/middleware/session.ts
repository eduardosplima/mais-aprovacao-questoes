import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";
import { getDb } from "../db/client";
import { loadEntitlement } from "../db/users";
import { getSessionCookie } from "../lib/cookies";
import { verifySession } from "../lib/jwt";

export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>(async (c, next) => {
  const token = getSessionCookie(c);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const userId = await verifySession(token, c.env.JWT_SECRET);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const ent = await loadEntitlement(getDb(c.env), userId);
  if (!ent) return c.json({ error: "unauthorized" }, 401);
  c.set("entitlement", ent);
  await next();
});
