import { createMiddleware } from "hono/factory";
import type { Env } from "../config/env";
import type { Entitlement } from "../db/users";

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>(async (c, next) => {
  const ent = c.get("entitlement");
  if (!ent || ent.role !== "admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});
