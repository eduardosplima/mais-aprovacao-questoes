import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { admins } from "./schema";
import { normalizeEmail } from "../lib/hmac";

export type AdminRow = typeof admins.$inferSelect;

export function findAdmin(db: Db, email: string): Promise<AdminRow | undefined> {
  return db
    .select()
    .from(admins)
    .where(eq(admins.email, normalizeEmail(email)))
    .get();
}

/**
 * Cria ou rotaciona. Só o CLI faz uma linha *nascer* — nenhuma rota cadastra
 * admin; `POST /admin/auth/senha` chama aqui para rotacionar a senha de uma
 * linha que já existe.
 */
export async function upsertAdmin(
  db: Db,
  email: string,
  passwordHash: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(admins)
    .values({
      email: normalizeEmail(email),
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: admins.email,
      set: { passwordHash, updatedAt: now },
    })
    .run();
}

export async function deleteAdmin(db: Db, email: string): Promise<void> {
  await db.delete(admins).where(eq(admins.email, normalizeEmail(email))).run();
}
