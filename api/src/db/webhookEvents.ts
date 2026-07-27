import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { webhookEvents } from "./schema";

export type ClaimResult = "claimed" | "already_done";

/**
 * Idempotência do webhook.
 *
 * Só `processed` e `ignored` deduplicam. Uma linha parada em `received`
 * significa que a tentativa anterior morreu no meio (ex.: falha no envio do
 * email) — nesse caso o evento DEVE ser reprocessado, senão a Hotmart
 * retentaria em vão e o aluno pagante ficaria sem acesso.
 */
export async function claimEvent(
  db: Db,
  id: string,
  event: string,
): Promise<ClaimResult> {
  const existing = await db
    .select({ status: webhookEvents.status })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .get();

  if (existing) {
    return existing.status === "received" ? "claimed" : "already_done";
  }

  await db
    .insert(webhookEvents)
    .values({ id, event, status: "received", receivedAt: new Date() })
    .onConflictDoNothing()
    .run();

  return "claimed";
}

export async function markProcessed(db: Db, id: string): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "processed" })
    .where(eq(webhookEvents.id, id))
    .run();
}

export async function markIgnored(
  db: Db,
  id: string,
  note: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "ignored", note })
    .where(eq(webhookEvents.id, id))
    .run();
}
