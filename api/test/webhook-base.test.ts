import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import { fakeEmailSender, envWith } from "./helpers";
import { purchaseApproved, postWebhook } from "./fixtures/hotmart";

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

describe("webhook — validação e idempotência", () => {
  it("401 sem header de hottok", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, purchaseApproved(), e, null);
    expect(res.status).toBe(401);
  });

  it("401 com hottok errado", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, purchaseApproved(), e, "hottok-errado");
    expect(res.status).toBe(401);
  });

  it("não registra o evento quando o hottok é inválido", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({ id: "evt-hottok-ruim" });
    await postWebhook(app, payload, e, "errado");

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-hottok-ruim"))
      .get();
    expect(row).toBeUndefined();
  });

  it("400 com corpo que não é JSON", async () => {
    const { env: e } = testEnv();
    const res = await app.request(
      "/webhooks/hotmart",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hotmart-hottok": "test-hottok",
        },
        body: "isto não é json",
      },
      e,
    );
    expect(res.status).toBe(400);
  });

  it("400 quando falta o id do evento", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(app, { event: "PURCHASE_APPROVED" }, e);
    expect(res.status).toBe(400);
  });

  it("aceita campos desconhecidos (parse tolerante)", async () => {
    const { env: e } = testEnv();
    const payload = {
      ...purchaseApproved({ id: "evt-tolerante" }),
      campo_novo_da_hotmart: { qualquer: "coisa" },
    };
    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);
  });

  it("reenvio do mesmo id devolve duplicate e não reprocessa", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({ id: "evt-dup" });

    const first = await postWebhook(app, payload, e);
    const second = await postWebhook(app, payload, e);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
  });

  it("ucode fora da lista é ignorado", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-outro-produto",
      ucode: "UCODE_DE_OUTRO_PRODUTO",
    });

    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-outro-produto"))
      .get();
    expect(row?.status).toBe("ignored");
  });

  it("PURCHASE_COMPLETE é registrado sem efeito no acesso", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-complete",
      event: "PURCHASE_COMPLETE",
    });

    const res = await postWebhook(app, payload, e);
    expect(res.status).toBe(200);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-complete"))
      .get();
    expect(row?.status).toBe("ignored");
    expect(row?.note).toContain("garantia");
  });

  it("evento com ucode válido mas sem subscriber code é ignorado", async () => {
    const { env: e } = testEnv();
    const payload = purchaseApproved({
      id: "evt-sem-subcode",
      subscriberCode: null,
    });

    await postWebhook(app, payload, e);

    const row = await getDb(env)
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-sem-subcode"))
      .get();
    expect(row?.status).toBe("ignored");
  });
});
