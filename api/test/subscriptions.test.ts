import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase } from "../src/db/users";
import {
  upsertSubscription,
  findSubscriptionByCode,
  listSubscriptionCodes,
  setAccessUntil,
  revokeAccess,
} from "../src/db/subscriptions";

const db = () => getDb(env);

async function aUser(email: string): Promise<string> {
  return upsertUserFromPurchase(db(), { email, name: null, documentHash: null });
}

describe("upsertSubscription", () => {
  it("cria a assinatura", async () => {
    const userId = await aUser("sub1@test.com");
    const until = new Date(Date.now() + 86400000);

    await upsertSubscription(db(), {
      subscriberCode: "SUB-1",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      accessUntil: until,
      lastTransaction: "HP123",
    });

    const row = await findSubscriptionByCode(db(), "SUB-1");
    expect(row?.userId).toBe(userId);
    expect(row?.planName).toBe("Mensal");
    expect(row?.status).toBe("ACTIVE");
    expect(row?.accessUntil?.getTime()).toBe(until.getTime());
    expect(row?.lastTransaction).toBe("HP123");
  });

  it("atualiza a assinatura existente sem duplicar (renovação)", async () => {
    const userId = await aUser("sub2@test.com");
    const first = new Date(Date.now() + 86400000);
    const renewed = new Date(Date.now() + 30 * 86400000);

    const base = {
      subscriberCode: "SUB-2",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      lastTransaction: "HP1",
    };
    await upsertSubscription(db(), { ...base, accessUntil: first });
    await upsertSubscription(db(), {
      ...base,
      accessUntil: renewed,
      lastTransaction: "HP2",
    });

    const row = await findSubscriptionByCode(db(), "SUB-2");
    expect(row?.accessUntil?.getTime()).toBe(renewed.getTime());
    expect(row?.lastTransaction).toBe("HP2");

    const codes = await listSubscriptionCodes(db());
    expect(codes.filter((c) => c === "SUB-2")).toHaveLength(1);
  });

  it("preserva created_at na atualização", async () => {
    const userId = await aUser("sub3@test.com");
    const base = {
      subscriberCode: "SUB-3",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    };
    await upsertSubscription(db(), base);
    const created = (await findSubscriptionByCode(db(), "SUB-3"))!.createdAt;

    await upsertSubscription(db(), { ...base, status: "DELAYED" });
    const after = await findSubscriptionByCode(db(), "SUB-3");

    expect(after!.createdAt.getTime()).toBe(created.getTime());
    expect(after!.status).toBe("DELAYED");
  });
});

describe("mutações de acesso", () => {
  it("setAccessUntil corrige só a data", async () => {
    const userId = await aUser("sub4@test.com");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-4",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    });

    const corrected = new Date(Date.now() + 10 * 86400000);
    await setAccessUntil(db(), "SUB-4", corrected);

    const row = await findSubscriptionByCode(db(), "SUB-4");
    expect(row?.accessUntil?.getTime()).toBe(corrected.getTime());
    expect(row?.status).toBe("ACTIVE");
  });

  it("revokeAccess põe access_until no passado e grava o status", async () => {
    const userId = await aUser("sub5@test.com");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-5",
      userId,
      productUcode: "UCODE_ASSINATURA",
      planName: null,
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 30 * 86400000),
      lastTransaction: null,
    });

    await revokeAccess(db(), "SUB-5", "REFUNDED");

    const row = await findSubscriptionByCode(db(), "SUB-5");
    expect(row?.status).toBe("REFUNDED");
    expect(row!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("findSubscriptionByCode devolve undefined para código desconhecido", async () => {
    expect(await findSubscriptionByCode(db(), "NAO-EXISTE")).toBeUndefined();
  });
});
