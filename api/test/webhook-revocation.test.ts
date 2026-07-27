import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import { findUserByEmail, loadEntitlement } from "../src/db/users";
import { findSubscriptionByCode } from "../src/db/subscriptions";
import { fakeEmailSender, envWith } from "./helpers";
import {
  purchaseApproved,
  subscriptionCancellation,
  postWebhook,
} from "./fixtures/hotmart";

const db = () => getDb(env);

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

/** Cria uma assinatura ativa e devolve o código. */
async function assinaturaAtiva(
  email: string,
  code: string,
  dateNextCharge = Date.now() + 30 * 86400000,
): Promise<string> {
  const { env: e } = testEnv();
  await postWebhook(
    app,
    purchaseApproved({ email, subscriberCode: code, dateNextCharge }),
    e,
  );
  return code;
}

describe("eventos de revogação", () => {
  it.each([
    ["PURCHASE_REFUNDED", "REFUNDED"],
    ["PURCHASE_CHARGEBACK", "CHARGEBACK"],
    ["PURCHASE_PROTEST", "PROTEST"],
  ])("%s revoga o acesso imediatamente", async (evento, statusEsperado) => {
    const code = `SUB-REV-${evento}`;
    await assinaturaAtiva(`${evento.toLowerCase()}@test.com`, code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: evento, subscriberCode: code }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe(statusEsperado);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("revogação derruba o tier para gratuito", async () => {
    const code = "SUB-REV-TIER";
    await assinaturaAtiva("tier-revogado@test.com", code);

    const user = await findUserByEmail(db(), "tier-revogado@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_REFUNDED", subscriberCode: code }),
      e,
    );

    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("gratuito");
  });

  it("PURCHASE_DELAYED marca o status mas PRESERVA access_until", async () => {
    const code = "SUB-DELAYED";
    const acesso = Date.now() + 20 * 86400000;
    await assinaturaAtiva("atrasado@test.com", code, acesso);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_DELAYED", subscriberCode: code }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe("DELAYED");
    expect(sub?.accessUntil?.getTime()).toBe(acesso);

    const user = await findUserByEmail(db(), "atrasado@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");
  });

  it("PURCHASE_EXPIRED marca EXPIRED quando a assinatura existe", async () => {
    const code = "SUB-EXPIRED";
    await assinaturaAtiva("expirou@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ event: "PURCHASE_EXPIRED", subscriberCode: code }),
      e,
    );

    expect((await findSubscriptionByCode(db(), code))?.status).toBe("EXPIRED");
  });

  it("Finding 5: evento 'constructor' é tratado como não-manipulado, não como revogação", async () => {
    const code = "SUB-CONSTRUCTOR";
    await assinaturaAtiva("constructor@test.com", code);

    const { env: e } = testEnv();
    const res = await postWebhook(
      app,
      purchaseApproved({
        id: "evt-constructor",
        event: "constructor",
        subscriberCode: code,
      }),
      e,
    );
    expect(res.status).toBe(200);

    // não revogou: o acesso concedido por assinaturaAtiva continua de pé.
    const sub = await findSubscriptionByCode(db(), code);
    expect(sub!.accessUntil!.getTime()).toBeGreaterThan(Date.now());

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-constructor"))
      .get();
    expect(row?.status).toBe("ignored");
    expect(row?.note).toContain("não tratado");
  });

  it("evento de revogação para código desconhecido é ignorado", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        id: "evt-rev-desconhecido",
        event: "PURCHASE_REFUNDED",
        subscriberCode: "SUB-QUE-NAO-EXISTE",
      }),
      e,
    );

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-rev-desconhecido"))
      .get();
    expect(row?.status).toBe("ignored");
  });
});

describe("SUBSCRIPTION_CANCELLATION", () => {
  it("mantém o acesso até date_next_charge (fim do ciclo pago)", async () => {
    const code = "SUB-CANCEL-1";
    await assinaturaAtiva("cancelou@test.com", code);

    const fimDoCiclo = Date.now() + 15 * 86400000;
    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({
        subscriberCode: code,
        dateNextCharge: fimDoCiclo,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub?.status).toBe("CANCELLED");
    expect(sub?.accessUntil?.getTime()).toBe(fimDoCiclo);

    // ainda assinante: o ciclo pago não acabou
    const user = await findUserByEmail(db(), "cancelou@test.com");
    expect((await loadEntitlement(db(), user!.id))?.tier).toBe("assinante");
  });

  it("sem date_next_charge, revoga na hora", async () => {
    const code = "SUB-CANCEL-2";
    await assinaturaAtiva("cancelou-sem-data@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({ subscriberCode: code, dateNextCharge: null }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("date_next_charge no passado revoga na hora", async () => {
    const code = "SUB-CANCEL-3";
    await assinaturaAtiva("cancelou-passado@test.com", code);

    const { env: e } = testEnv();
    await postWebhook(
      app,
      subscriptionCancellation({
        subscriberCode: code,
        dateNextCharge: Date.now() - 86400000,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), code);
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("subscriber code desconhecido é ignorado sem erro", async () => {
    const { env: e } = testEnv();
    const res = await postWebhook(
      app,
      subscriptionCancellation({
        id: "evt-cancel-desconhecido",
        subscriberCode: "SUB-DE-OUTRO-SISTEMA",
      }),
      e,
    );
    expect(res.status).toBe(200);

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "evt-cancel-desconhecido"))
      .get();
    expect(row?.status).toBe("ignored");
  });

  it("funciona sem product.ucode no payload (que o cancelamento não traz)", async () => {
    const code = "SUB-CANCEL-4";
    await assinaturaAtiva("cancel-sem-ucode@test.com", code);

    const payload = subscriptionCancellation({ subscriberCode: code });
    expect((payload.data.product as Record<string, unknown>).ucode).toBeUndefined();

    const { env: e } = testEnv();
    await postWebhook(app, payload, e);

    expect((await findSubscriptionByCode(db(), code))?.status).toBe("CANCELLED");
  });
});
