import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { users, subscriptions } from "../src/db/schema";
import {
  upsertUserFromPurchase,
  findUserByEmail,
  setPasswordHash,
  loadEntitlement,
} from "../src/db/users";

const db = () => getDb(env);
const ADMINS = ["admin@test.com"];

async function addSubscription(
  userId: string,
  code: string,
  accessUntil: Date | null,
) {
  const now = new Date();
  await db()
    .insert(subscriptions)
    .values({
      hotmartSubscriberCode: code,
      userId,
      productUcode: "UCODE_ASSINATURA",
      status: "ACTIVE",
      accessUntil,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("upsertUserFromPurchase", () => {
  it("cria o usuário com role 'user'", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "novo@test.com", name: "Aluno Novo", documentHash: "hash-doc" },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "novo@test.com");
    expect(row?.id).toBe(id);
    expect(row?.role).toBe("user");
    expect(row?.name).toBe("Aluno Novo");
    expect(row?.documentHash).toBe("hash-doc");
    expect(row?.passwordHash).toBeNull();
  });

  it("concede role 'admin' pela allowlist", async () => {
    await upsertUserFromPurchase(
      db(),
      { email: "admin@test.com", name: null, documentHash: null },
      ADMINS,
    );
    const row = await findUserByEmail(db(), "admin@test.com");
    expect(row?.role).toBe("admin");
  });

  it("é idempotente: segunda compra reusa o mesmo usuário", async () => {
    const first = await upsertUserFromPurchase(
      db(),
      { email: "repetido@test.com", name: "Nome", documentHash: "d1" },
      ADMINS,
    );
    const second = await upsertUserFromPurchase(
      db(),
      { email: "repetido@test.com", name: "Nome", documentHash: "d1" },
      ADMINS,
    );
    expect(second).toBe(first);
  });

  it("não apaga name/documentHash quando o novo payload vem sem eles", async () => {
    await upsertUserFromPurchase(
      db(),
      { email: "preserva@test.com", name: "Tem Nome", documentHash: "tem-doc" },
      ADMINS,
    );
    await upsertUserFromPurchase(
      db(),
      { email: "preserva@test.com", name: null, documentHash: null },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "preserva@test.com");
    expect(row?.name).toBe("Tem Nome");
    expect(row?.documentHash).toBe("tem-doc");
  });

  it("nunca reseta a senha já definida", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "comsenha@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await setPasswordHash(db(), id, "pbkdf2$sha256$100000$s$h");
    await upsertUserFromPurchase(
      db(),
      { email: "comsenha@test.com", name: null, documentHash: null },
      ADMINS,
    );

    const row = await findUserByEmail(db(), "comsenha@test.com");
    expect(row?.passwordHash).toBe("pbkdf2$sha256$100000$s$h");
  });
});

describe("loadEntitlement", () => {
  it("retorna null para usuário inexistente", async () => {
    expect(await loadEntitlement(db(), "nao-existe")).toBeNull();
  });

  it("tier 'gratuito' sem assinatura", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "sem-sub@test.com", name: null, documentHash: null },
      ADMINS,
    );
    const ent = await loadEntitlement(db(), id);
    expect(ent?.tier).toBe("gratuito");
    expect(ent?.role).toBe("user");
    expect(ent?.email).toBe("sem-sub@test.com");
  });

  it("tier 'assinante' com access_until no futuro", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "ativo@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-1", new Date(Date.now() + 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("assinante");
  });

  it("tier 'gratuito' com access_until no passado", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "expirado@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-2", new Date(Date.now() - 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("gratuito");
  });

  it("tier 'gratuito' com access_until nulo", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "nulo@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-3", null);
    expect((await loadEntitlement(db(), id))?.tier).toBe("gratuito");
  });

  it("duas assinaturas, uma válida → assinante", async () => {
    const id = await upsertUserFromPurchase(
      db(),
      { email: "duas@test.com", name: null, documentHash: null },
      ADMINS,
    );
    await addSubscription(id, "SUB-ENT-4", new Date(Date.now() - 86400000));
    await addSubscription(id, "SUB-ENT-5", new Date(Date.now() + 86400000));
    expect((await loadEntitlement(db(), id))?.tier).toBe("assinante");
  });
});
