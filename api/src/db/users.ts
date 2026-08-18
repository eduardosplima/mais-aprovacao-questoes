import { eq, and, gt } from "drizzle-orm";
import type { Db } from "./client";
import { users, subscriptions } from "./schema";

export type Tier = "assinante" | "gratuito";

export type UserRow = typeof users.$inferSelect;

export interface Entitlement {
  userId: string;
  email: string;
  name: string | null;
  tier: Tier;
}

/** Identidade extraída de um evento de compra. `email` já normalizado. */
export interface PurchaseIdentity {
  email: string;
  name: string | null;
  documentHash: string | null;
}

export function findUserByEmail(
  db: Db,
  email: string,
): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/**
 * Cria ou atualiza o usuário a partir de uma compra.
 *
 * Regras:
 * - Não existe papel aqui. Admin é outro sistema (`db/admins.ts`), e uma
 *   compra com email de admin cria uma conta de aluno como outra qualquer.
 * - `name`/`documentHash` nulos no payload não sobrescrevem valores já gravados
 *   (a Hotmart só envia campos do comprador que o checkout solicitou).
 * - `documentHash` já gravado (não nulo) NUNCA é sobrescrito, mesmo por um
 *   valor novo não-nulo: quem compra com o email de outra pessoa poderia
 *   assim instalar um CPF que conhece, que o /auth/recover passaria a aceitar.
 *   Só preenche quando o campo está atualmente nulo.
 * - `passwordHash` nunca é tocado aqui.
 */
export async function upsertUserFromPurchase(
  db: Db,
  identity: PurchaseIdentity,
): Promise<string> {
  const now = new Date();
  const existing = await findUserByEmail(db, identity.email);

  if (existing) {
    await db
      .update(users)
      .set({
        name: identity.name ?? existing.name,
        documentHash: existing.documentHash ?? identity.documentHash,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id,
      email: identity.email,
      name: identity.name,
      documentHash: identity.documentHash,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export async function setPasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Ponto único de derivação do tier. Chamado a cada request protegido, o que
 * faz a revogação ser imediata: o JWT não carrega role nem tier.
 *
 * `access_until > now` é o ÚNICO predicado de acesso. `status` não participa.
 */
export async function loadEntitlement(
  db: Db,
  userId: string,
): Promise<Entitlement | null> {
  const user = await findUserById(db, userId);
  if (!user) return null;

  const active = await db
    .select({ code: subscriptions.hotmartSubscriberCode })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        gt(subscriptions.accessUntil, new Date()),
      ),
    )
    .get();

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    tier: active ? "assinante" : "gratuito",
  };
}
