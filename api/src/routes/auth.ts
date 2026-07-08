import { Hono } from "hono";
import type { Env } from "../config/env";
import { getAdminEmails } from "../config/env";
import type { Entitlement, HotmartIdentity } from "../db/users";
import { getDb } from "../db/client";
import { upsertUser, ensureSubscription } from "../db/users";
import { signSession } from "../lib/jwt";
import {
  setStateCookie,
  getStateCookie,
  clearStateCookie,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/cookies";
import { createHotmartClient } from "../lib/hotmart";
import { requireSession } from "../middleware/session";

export const auth = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

auth.get("/login", async (c) => {
  const state = crypto.randomUUID();
  await setStateCookie(c, state, c.env.COOKIE_SIGNING_KEY);
  return c.redirect(createHotmartClient(c.env).authorizeUrl(state), 302);
});

auth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const stateCookie = await getStateCookie(c, c.env.COOKIE_SIGNING_KEY);
  clearStateCookie(c);
  if (!code || !stateParam || !stateCookie || stateCookie !== stateParam) {
    return c.json({ error: "invalid_state" }, 400);
  }

  const hotmart = createHotmartClient(c.env);
  let identity: HotmartIdentity;
  try {
    const { accessToken } = await hotmart.exchangeCode(code);
    identity = await hotmart.fetchIdentity(accessToken);
  } catch {
    return c.json({ error: "oauth_failed" }, 400);
  }

  const db = getDb(c.env);
  const userId = await upsertUser(db, identity, getAdminEmails(c.env));
  await ensureSubscription(db, userId);
  setSessionCookie(c, await signSession(userId, c.env.JWT_SECRET));
  return c.json({ ok: true });
});

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
