import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { deletedAccounts } from "./schema";

/**
 * Tombstone de exclusão de conta.
 *
 * Sem ela, o cron veria a assinatura ainda listada na API (assinatura
 * cancelada tem date_next_charge no futuro), a acharia ausente no D1, e
 * recriaria a conta com email de boas-vindas — desfazendo a exclusão na
 * madrugada seguinte ao pedido do titular.
 *
 * Guarda apenas o HMAC do email: nenhum dado legível.
 */
export async function isDeleted(db: Db, emailHash: string): Promise<boolean> {
  const row = await db
    .select({ hash: deletedAccounts.emailHash })
    .from(deletedAccounts)
    .where(eq(deletedAccounts.emailHash, emailHash))
    .get();
  return row !== undefined;
}

export async function markDeleted(db: Db, emailHash: string): Promise<void> {
  await db
    .insert(deletedAccounts)
    .values({ emailHash, deletedAt: new Date() })
    .onConflictDoNothing()
    .run();
}

/** Chamado numa compra nova (recurrence_number == 1): a tombstone não é banimento. */
export async function clearTombstone(
  db: Db,
  emailHash: string,
): Promise<void> {
  await db
    .delete(deletedAccounts)
    .where(eq(deletedAccounts.emailHash, emailHash))
    .run();
}
