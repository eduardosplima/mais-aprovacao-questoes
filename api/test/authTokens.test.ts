import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase } from "../src/db/users";
import { hashToken } from "../src/lib/tokens";
import {
  createToken,
  consumeToken,
  hasPendingToken,
  issuedWithin,
  FIRST_ACCESS_TTL_MS,
  RECOVERY_TTL_MS,
  RECOVERY_COOLDOWN_MS,
} from "../src/db/authTokens";

const db = () => getDb(env);

async function aUser(email: string): Promise<string> {
  return upsertUserFromPurchase(db(), { email, name: null, documentHash: null });
}

describe("createToken", () => {
  it("grava só o hash, nunca o token em claro", async () => {
    const userId = await aUser("tok1@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    const byHash = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .get();
    const byPlain = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, token))
      .get();

    expect(byHash?.userId).toBe(userId);
    expect(byPlain).toBeUndefined();
  });

  it("respeita o TTL recebido", async () => {
    const userId = await aUser("tok2@test.com");
    const token = await createToken(db(), userId, RECOVERY_TTL_MS);

    const row = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .get();

    const delta = row!.expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(RECOVERY_TTL_MS - 10_000);
    expect(delta).toBeLessThanOrEqual(RECOVERY_TTL_MS);
  });
});

describe("consumeToken", () => {
  it("aceita o token válido e devolve o userId", async () => {
    const userId = await aUser("tok3@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    expect(await consumeToken(db(), token)).toBe(userId);
  });

  it("rejeita token inexistente", async () => {
    expect(await consumeToken(db(), "token-que-nao-existe")).toBeNull();
  });

  it("rejeita token já usado", async () => {
    const userId = await aUser("tok4@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), token)).toBe(userId);
    expect(await consumeToken(db(), token)).toBeNull();
  });

  it("rejeita token expirado", async () => {
    const userId = await aUser("tok5@test.com");
    const token = await createToken(db(), userId, 1000);

    // envelhece o token diretamente no banco
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await consumeToken(db(), token)).toBeNull();
  });

  it("ao usar um token, invalida os demais do mesmo usuário", async () => {
    const userId = await aUser("tok6@test.com");
    const first = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    const second = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), second)).toBe(userId);
    expect(await consumeToken(db(), first)).toBeNull();
  });

  it("não afeta tokens de outro usuário", async () => {
    const a = await aUser("tok7a@test.com");
    const b = await aUser("tok7b@test.com");
    const tokenA = await createToken(db(), a, FIRST_ACCESS_TTL_MS);
    const tokenB = await createToken(db(), b, FIRST_ACCESS_TTL_MS);

    expect(await consumeToken(db(), tokenA)).toBe(a);
    expect(await consumeToken(db(), tokenB)).toBe(b);
  });

  it("chamadas concorrentes com o mesmo token: só uma vence", async () => {
    const userId = await aUser("tok13@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);

    const [first, second] = await Promise.all([
      consumeToken(db(), token),
      consumeToken(db(), token),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r === userId)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });
});

describe("hasPendingToken", () => {
  it("false sem token, true com token válido", async () => {
    const userId = await aUser("tok8@test.com");
    expect(await hasPendingToken(db(), userId)).toBe(false);

    await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    expect(await hasPendingToken(db(), userId)).toBe(true);
  });

  it("false depois de o token ser consumido", async () => {
    const userId = await aUser("tok9@test.com");
    const token = await createToken(db(), userId, FIRST_ACCESS_TTL_MS);
    await consumeToken(db(), token);
    expect(await hasPendingToken(db(), userId)).toBe(false);
  });

  it("false para token expirado", async () => {
    const userId = await aUser("tok10@test.com");
    const token = await createToken(db(), userId, 1000);
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await hasPendingToken(db(), userId)).toBe(false);
  });
});

describe("issuedWithin (cooldown)", () => {
  it("true logo após emitir, false se o token for antigo", async () => {
    const userId = await aUser("tok11@test.com");
    const token = await createToken(db(), userId, RECOVERY_TTL_MS);
    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(true);

    await db()
      .update(authTokens)
      .set({ createdAt: new Date(Date.now() - RECOVERY_COOLDOWN_MS - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(false);
  });

  it("false para usuário sem nenhum token", async () => {
    const userId = await aUser("tok12@test.com");
    expect(await issuedWithin(db(), userId, RECOVERY_COOLDOWN_MS)).toBe(false);
  });
});
