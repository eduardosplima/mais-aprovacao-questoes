import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import { findAdmin, upsertAdmin, deleteAdmin } from "../src/db/admins";

const db = () => getDb(env);

describe("db/admins", () => {
  it("upsert cria e findAdmin devolve", async () => {
    await upsertAdmin(db(), "novo@test.com", "hash-1");
    const achado = await findAdmin(db(), "novo@test.com");
    expect(achado?.passwordHash).toBe("hash-1");
  });

  it("upsert do mesmo email troca a senha em vez de duplicar", async () => {
    await upsertAdmin(db(), "rotaciona@test.com", "hash-1");
    await upsertAdmin(db(), "rotaciona@test.com", "hash-2");
    const achado = await findAdmin(db(), "rotaciona@test.com");
    expect(achado?.passwordHash).toBe("hash-2");
  });

  // O email é a chave e vem do token do Access, que não garante caixa.
  it("normaliza o email na escrita e na leitura", async () => {
    await upsertAdmin(db(), "  Maiuscula@Test.com ", "hash-1");
    expect(await findAdmin(db(), "maiuscula@test.com")).toBeDefined();
    expect(await findAdmin(db(), "MAIUSCULA@TEST.COM")).toBeDefined();
  });

  it("deleteAdmin apaga", async () => {
    await upsertAdmin(db(), "sai@test.com", "hash-1");
    await deleteAdmin(db(), "sai@test.com");
    expect(await findAdmin(db(), "sai@test.com")).toBeUndefined();
  });

  it("findAdmin de email inexistente devolve undefined", async () => {
    expect(await findAdmin(db(), "ninguem@test.com")).toBeUndefined();
  });
});
