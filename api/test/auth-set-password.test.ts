import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase, findUserByEmail } from "../src/db/users";
import { createToken, FIRST_ACCESS_TTL_MS } from "../src/db/authTokens";
import { hashToken } from "../src/lib/tokens";
import { verifyPassword } from "../src/lib/password";
import { cookieFrom } from "./helpers";

const db = () => getDb(env);

async function userComToken(email: string): Promise<{ id: string; token: string }> {
  const id = await upsertUserFromPurchase(db(), {
    email,
    name: "Aluno",
    documentHash: null,
  });
  return { id, token: await createToken(db(), id, FIRST_ACCESS_TTL_MS) };
}

function setPassword(token: string, password: string) {
  return app.request(
    "/auth/set-password",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    },
    env,
  );
}

describe("POST /auth/set-password", () => {
  it("define a senha e já emite a sessão", async () => {
    const { id, token } = await userComToken("sp1@test.com");

    const res = await setPassword(token, "senha-forte-1");
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "session")).toBeTruthy();

    const user = await findUserByEmail(db(), "sp1@test.com");
    expect(user!.id).toBe(id);
    expect(user!.passwordHash).toBeTruthy();
    expect(await verifyPassword("senha-forte-1", user!.passwordHash!)).toBe(true);
  });

  it("a sessão emitida funciona no /auth/me", async () => {
    const { token } = await userComToken("sp2@test.com");
    const res = await setPassword(token, "senha-forte-2");
    const session = cookieFrom(res, "session")!;

    const me = await app.request(
      "/auth/me",
      { headers: { cookie: session } },
      env,
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email: "sp2@test.com",
      tier: "gratuito",
    });
  });

  it("400 com token inexistente", async () => {
    const res = await setPassword("token-que-nunca-existiu", "senha-forte-3");
    expect(res.status).toBe(400);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com token já usado", async () => {
    const { token } = await userComToken("sp3@test.com");
    expect((await setPassword(token, "senha-forte-4")).status).toBe(200);
    expect((await setPassword(token, "outra-senha-5")).status).toBe(400);
  });

  it("400 com token expirado", async () => {
    const { token } = await userComToken("sp4@test.com");
    await db()
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.tokenHash, await hashToken(token)))
      .run();

    expect((await setPassword(token, "senha-forte-6")).status).toBe(400);
  });

  it("400 com senha menor que 8 caracteres, sem queimar o token", async () => {
    const { token } = await userComToken("sp5@test.com");

    const curta = await setPassword(token, "1234567");
    expect(curta.status).toBe(400);

    // o token continua válido: o aluno pode tentar de novo
    expect((await setPassword(token, "senha-valida")).status).toBe(200);
  });

  it("400 com corpo malformado", async () => {
    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "não é json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 quando falta o campo token", async () => {
    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "senha-forte-7" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("usar um token invalida os demais do mesmo usuário", async () => {
    const id = await upsertUserFromPurchase(db(), {
      email: "sp6@test.com",
      name: null,
      documentHash: null,
    });
    const antigo = await createToken(db(), id, FIRST_ACCESS_TTL_MS);
    const novo = await createToken(db(), id, FIRST_ACCESS_TTL_MS);

    expect((await setPassword(novo, "senha-forte-8")).status).toBe(200);
    expect((await setPassword(antigo, "senha-forte-9")).status).toBe(400);
  });
});
