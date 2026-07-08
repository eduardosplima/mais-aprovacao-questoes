import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { users, subscriptions } from "./schema";

export type Tier = "assinante" | "gratuito";

export interface HotmartIdentity {
  hotmartUserId: string;
  email: string;
}

export interface Entitlement {
  userId: string;
  email: string;
  role: "admin" | "user";
  tier: Tier;
}

export async function upsertUser(
  db: Db,
  identity: HotmartIdentity,
  adminEmails: string[],
): Promise<string> {
  const email = identity.email.trim().toLowerCase();
  const role = adminEmails.includes(email) ? "admin" : "user";
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existing) {
    await db
      .update(users)
      .set({ hotmartUserId: identity.hotmartUserId, role })
      .where(eq(users.id, existing.id))
      .run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id,
      email,
      hotmartUserId: identity.hotmartUserId,
      role,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export async function ensureSubscription(
  db: Db,
  userId: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .get();
  if (!existing) {
    await db.insert(subscriptions).values({ userId, status: "none" }).run();
  }
}

export async function loadEntitlement(
  db: Db,
  userId: string,
): Promise<Entitlement | null> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;
  const sub = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .get();
  const tier: Tier = sub?.status === "ACTIVE" ? "assinante" : "gratuito";
  return {
    userId: user.id,
    email: user.email,
    role: user.role as "admin" | "user",
    tier,
  };
}
