import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { subscriptions } from "./schema";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export interface SubscriptionUpsert {
  subscriberCode: string;
  userId: string;
  productUcode: string;
  planName: string | null;
  status: string;
  accessUntil: Date | null;
  lastTransaction: string | null;
}

export function findSubscriptionByCode(
  db: Db,
  code: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .get();
}

export async function listSubscriptionCodes(db: Db): Promise<string[]> {
  const rows = await db
    .select({ code: subscriptions.hotmartSubscriberCode })
    .from(subscriptions)
    .all();
  return rows.map((r) => r.code);
}

/** Upsert pela PK `hotmart_subscriber_code`. Preserva `created_at`. */
export async function upsertSubscription(
  db: Db,
  input: SubscriptionUpsert,
): Promise<void> {
  const now = new Date();
  await db
    .insert(subscriptions)
    .values({
      hotmartSubscriberCode: input.subscriberCode,
      userId: input.userId,
      productUcode: input.productUcode,
      planName: input.planName,
      status: input.status,
      accessUntil: input.accessUntil,
      lastTransaction: input.lastTransaction,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.hotmartSubscriberCode,
      set: {
        userId: input.userId,
        productUcode: input.productUcode,
        planName: input.planName,
        status: input.status,
        accessUntil: input.accessUntil,
        lastTransaction: input.lastTransaction,
        updatedAt: now,
      },
    })
    .run();
}

export async function setAccessUntil(
  db: Db,
  code: string,
  accessUntil: Date,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ accessUntil, updatedAt: new Date() })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}

export async function setStatus(
  db: Db,
  code: string,
  status: string,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status, updatedAt: new Date() })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}

/** Revogação = escrever `access_until` no passado. É o único mecanismo. */
export async function revokeAccess(
  db: Db,
  code: string,
  status: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(subscriptions)
    .set({ status, accessUntil: now, updatedAt: now })
    .where(eq(subscriptions.hotmartSubscriberCode, code))
    .run();
}
