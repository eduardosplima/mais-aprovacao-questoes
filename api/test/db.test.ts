import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import {
  users,
  subscriptions,
  authTokens,
  webhookEvents,
  deletedAccounts,
} from "../src/db/schema";

const db = () => getDb(env);

async function seedUser(id: string, email: string) {
  const now = new Date();
  await db()
    .insert(users)
    .values({ id, email, createdAt: now, updatedAt: now })
    .run();
  return id;
}

describe("schema", () => {
  it("grava e lê um usuário com os campos novos", async () => {
    const now = new Date();
    await db()
      .insert(users)
      .values({
        id: "u-schema-1",
        email: "schema1@test.com",
        name: "Aluno Um",
        documentHash: "deadbeef",
        passwordHash: "pbkdf2$sha256$1$a$b",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = await db()
      .select()
      .from(users)
      .where(eq(users.id, "u-schema-1"))
      .get();

    expect(row?.name).toBe("Aluno Um");
    expect(row?.documentHash).toBe("deadbeef");
    expect(row?.passwordHash).toBe("pbkdf2$sha256$1$a$b");
    expect(row?.createdAt instanceof Date).toBe(true);
  });

  it("subscriptions tem PK em hotmart_subscriber_code", async () => {
    await seedUser("u-schema-2", "schema2@test.com");
    const now = new Date();
    await db()
      .insert(subscriptions)
      .values({
        hotmartSubscriberCode: "SUB-A",
        userId: "u-schema-2",
        productUcode: "UCODE_ASSINATURA",
        status: "ACTIVE",
        accessUntil: new Date(Date.now() + 86400000),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.hotmartSubscriberCode, "SUB-A"))
      .get();

    expect(row?.userId).toBe("u-schema-2");
  });

  it("um usuário pode ter duas assinaturas (1:N)", async () => {
    await seedUser("u-schema-3", "schema3@test.com");
    const now = new Date();
    for (const code of ["SUB-B", "SUB-C"]) {
      await db()
        .insert(subscriptions)
        .values({
          hotmartSubscriberCode: code,
          userId: "u-schema-3",
          productUcode: "UCODE_ASSINATURA",
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const rows = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "u-schema-3"))
      .all();

    expect(rows).toHaveLength(2);
  });

  it("DELETE em users cascateia para subscriptions e auth_tokens", async () => {
    await seedUser("u-schema-4", "schema4@test.com");
    const now = new Date();
    await db()
      .insert(subscriptions)
      .values({
        hotmartSubscriberCode: "SUB-D",
        userId: "u-schema-4",
        productUcode: "UCODE_ASSINATURA",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await db()
      .insert(authTokens)
      .values({
        tokenHash: "hash-d",
        userId: "u-schema-4",
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: now,
      })
      .run();

    await db().delete(users).where(eq(users.id, "u-schema-4")).run();

    const subs = await db()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "u-schema-4"))
      .all();
    const toks = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.userId, "u-schema-4"))
      .all();

    expect(subs).toHaveLength(0);
    expect(toks).toHaveLength(0);
  });

  it("webhook_events e deleted_accounts existem e aceitam escrita", async () => {
    await db()
      .insert(webhookEvents)
      .values({
        id: "evt-1",
        event: "PURCHASE_APPROVED",
        status: "processed",
        receivedAt: new Date(),
      })
      .run();
    await db()
      .insert(deletedAccounts)
      .values({ emailHash: "hash-email-1", deletedAt: new Date() })
      .run();

    const evt = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-1"))
      .get();
    const tomb = await db()
      .select()
      .from(deletedAccounts)
      .where(eq(deletedAccounts.emailHash, "hash-email-1"))
      .get();

    expect(evt?.status).toBe("processed");
    expect(tomb?.deletedAt instanceof Date).toBe(true);
  });
});
