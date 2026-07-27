import { eq, and, gt, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { authTokens } from "./schema";
import { generateToken, hashToken } from "../lib/tokens";

/** Email de compra pode ficar dias sem ser aberto. */
export const FIRST_ACCESS_TTL_MS = 172_800_000; // 48h
/** Recuperação é uma ação deliberada e imediata. */
export const RECOVERY_TTL_MS = 3_600_000; // 1h
/** Anti email-bombing de uma vítima cujo email+CPF o atacante conheça. */
export const RECOVERY_COOLDOWN_MS = 300_000; // 5min

/** Cria o token e devolve o valor EM CLARO — só o email o verá. */
export async function createToken(
  db: Db,
  userId: string,
  ttlMs: number,
): Promise<string> {
  const token = generateToken();
  const now = new Date();
  await db
    .insert(authTokens)
    .values({
      tokenHash: await hashToken(token),
      userId,
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    })
    .run();
  return token;
}

/**
 * Consome o token: valida, e ao aceitar marca TODOS os tokens do usuário como
 * usados. Um link novo invalida os anteriores.
 */
export async function consumeToken(
  db: Db,
  token: string,
): Promise<string | null> {
  const now = new Date();
  const row = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, await hashToken(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .get();

  if (!row) return null;

  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(eq(authTokens.userId, row.userId))
    .run();

  return row.userId;
}

/** Guarda contra enviar um segundo link quando já existe um válido. */
export async function hasPendingToken(
  db: Db,
  userId: string,
): Promise<boolean> {
  const row = await db
    .select({ hash: authTokens.tokenHash })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .get();
  return row !== undefined;
}

export async function issuedWithin(
  db: Db,
  userId: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const row = await db
    .select({ hash: authTokens.tokenHash })
    .from(authTokens)
    .where(
      and(eq(authTokens.userId, userId), gt(authTokens.createdAt, since)),
    )
    .get();
  return row !== undefined;
}
