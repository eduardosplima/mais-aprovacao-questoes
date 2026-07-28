import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import { findUserByEmail, setPasswordHash } from "../src/db/users";
import { findSubscriptionByCode } from "../src/db/subscriptions";
import { markDeleted, isDeleted } from "../src/db/deletedAccounts";
import { hasPendingToken } from "../src/db/authTokens";
import { hmacHex, normalizeDocument } from "../src/lib/hmac";
import { fakeEmailSender, envWith } from "./helpers";
import { purchaseApproved, postWebhook } from "./fixtures/hotmart";
import type { EmailSender } from "../src/config/env";

const db = () => getDb(env);

function testEnv() {
  const { sent, sender } = fakeEmailSender();
  return { sent, env: envWith({ EMAIL: sender }) };
}

const hashOf = (email: string) => hmacHex(email, env.DOCUMENT_HMAC_KEY);

describe("PURCHASE_APPROVED", () => {
  it("cria usuário e assinatura e envia o link mágico", async () => {
    const { sent, env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "novo-aluno@test.com",
        subscriberCode: "SUB-P1",
        name: "Aluno Novo",
      }),
      e,
    );

    const user = await findUserByEmail(db(), "novo-aluno@test.com");
    expect(user).toBeDefined();
    expect(user?.name).toBe("Aluno Novo");
    expect(user?.role).toBe("user");
    expect(user?.passwordHash).toBeNull();

    const sub = await findSubscriptionByCode(db(), "SUB-P1");
    expect(sub?.userId).toBe(user!.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.planName).toBe("Mensal");
    expect(sub?.lastTransaction).toBe("HP17715690036014");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("novo-aluno@test.com");
    expect(sent[0].subject.toLowerCase()).toContain("acesso");
  });

  it("normaliza o email do comprador", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "  MAIUSCULO@Test.COM  ",
        subscriberCode: "SUB-P2",
      }),
      e,
    );

    expect(await findUserByEmail(db(), "maiusculo@test.com")).toBeDefined();
  });

  it("grava o documento só como HMAC, nunca em claro", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "com-doc@test.com",
        subscriberCode: "SUB-P3",
        document: "123.456.789-09",
      }),
      e,
    );

    const user = await findUserByEmail(db(), "com-doc@test.com");
    expect(user?.documentHash).toBe(
      await hmacHex(normalizeDocument("123.456.789-09"), env.DOCUMENT_HMAC_KEY),
    );
    expect(user?.documentHash).not.toContain("123");
  });

  it("aceita compra sem documento (checkout que não pede CPF)", async () => {
    const { sent, env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "sem-doc@test.com",
        subscriberCode: "SUB-P4",
        document: null,
      }),
      e,
    );

    const user = await findUserByEmail(db(), "sem-doc@test.com");
    expect(user).toBeDefined();
    expect(user?.documentHash).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("usa date_next_charge como access_until", async () => {
    const { env: e } = testEnv();
    const nextCharge = Date.now() + 30 * 86400000;
    await postWebhook(
      app,
      purchaseApproved({
        email: "com-data@test.com",
        subscriberCode: "SUB-P5",
        dateNextCharge: nextCharge,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), "SUB-P5");
    expect(sub?.accessUntil?.getTime()).toBe(nextCharge);
  });

  it("sem date_next_charge, cai no fallback curto de 7 dias", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "sem-data@test.com",
        subscriberCode: "SUB-P6",
        dateNextCharge: null,
      }),
      e,
    );

    const sub = await findSubscriptionByCode(db(), "SUB-P6");
    const delta = sub!.accessUntil!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(6 * 86400000);
    expect(delta).toBeLessThanOrEqual(7 * 86400000);
  });

  it("concede admin pela allowlist, nunca pelo payload", async () => {
    const { env: e } = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "admin@test.com", subscriberCode: "SUB-P7" }),
      e,
    );

    const user = await findUserByEmail(db(), "admin@test.com");
    expect(user?.role).toBe("admin");
  });

  it("renovação (recurrence_number=2) estende o acesso sem reenviar email", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "renova@test.com",
        subscriberCode: "SUB-P8",
        recurrenceNumber: 1,
      }),
      first.env,
    );
    expect(first.sent).toHaveLength(1);

    const renewal = testEnv();
    const novoAcesso = Date.now() + 60 * 86400000;
    await postWebhook(
      app,
      purchaseApproved({
        email: "renova@test.com",
        subscriberCode: "SUB-P8",
        recurrenceNumber: 2,
        dateNextCharge: novoAcesso,
      }),
      renewal.env,
    );

    expect(renewal.sent).toHaveLength(0);
    const sub = await findSubscriptionByCode(db(), "SUB-P8");
    expect(sub?.accessUntil?.getTime()).toBe(novoAcesso);
  });

  it("não reenvia link se já existe um token pendente", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "pendente@test.com",
        subscriberCode: "SUB-P9",
      }),
      first.env,
    );
    expect(first.sent).toHaveLength(1);

    // outro evento (id diferente), mesmo comprador, ainda sem senha definida
    const second = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "pendente@test.com",
        subscriberCode: "SUB-P9",
      }),
      second.env,
    );
    expect(second.sent).toHaveLength(0);
  });

  it("Finding 1: envio falha → token some, evento fica pendente, e o retry da Hotmart reenvia", async () => {
    const eventId = "evt-retry-p9-falha";
    const payload = purchaseApproved({
      id: eventId,
      email: "retry-falha@test.com",
      subscriberCode: "SUB-P9-RETRY",
    });
    const failingSender: EmailSender = {
      async send() {
        throw new Error("smtp indisponível");
      },
    };

    // 1ª tentativa: o envio falha, o Worker responde 5xx (Hono captura a
    // exceção lançada pelo handler e a transforma numa resposta de erro).
    const first = await postWebhook(app, payload, envWith({ EMAIL: failingSender }));
    expect(first.status).toBe(500);

    const user = await findUserByEmail(db(), "retry-falha@test.com");
    expect(user).toBeDefined();
    expect(user?.passwordHash).toBeNull();

    // Sem o fix, este token ficaria pendente para sempre: hasPendingToken
    // travaria qualquer reenvio futuro para um aluno que nunca recebeu nada.
    expect(await hasPendingToken(db(), user!.id)).toBe(false);

    // O evento nunca chegou a 'processed' — continua 'received' para a
    // Hotmart retentar.
    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, eventId))
      .get();
    expect(row?.status).toBe("received");

    // 2ª tentativa: a Hotmart reenvia o MESMO evento (mesmo id) após o 5xx.
    // Com o slate limpo, o email agora DEVE sair.
    const { sent, env: retryEnv } = testEnv();
    const second = await postWebhook(app, payload, retryEnv);

    expect(second.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("retry-falha@test.com");
  });

  it("não envia link para quem já definiu senha", async () => {
    const first = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "ja-tem-senha@test.com",
        subscriberCode: "SUB-P10",
      }),
      first.env,
    );

    const user = await findUserByEmail(db(), "ja-tem-senha@test.com");
    await setPasswordHash(db(), user!.id, "pbkdf2$sha256$100000$s$h");

    const second = testEnv();
    await postWebhook(
      app,
      purchaseApproved({
        email: "ja-tem-senha@test.com",
        subscriberCode: "SUB-P10",
      }),
      second.env,
    );
    expect(second.sent).toHaveLength(0);
  });

  it("Finding 3: nome com quebras de linha e caracteres de controle é gravado achatado e truncado em 60", async () => {
    const { env: e } = testEnv();
    const nomeMalicioso =
      "Fulano\n\nSua assinatura venceu, clique aqui: http://phish.example\r\n\t" +
      "x".repeat(60);

    await postWebhook(
      app,
      purchaseApproved({
        email: "nome-malicioso@test.com",
        subscriberCode: "SUB-P14",
        name: nomeMalicioso,
      }),
      e,
    );

    const user = await findUserByEmail(db(), "nome-malicioso@test.com");
    expect(user?.name).not.toContain("\n");
    expect(user?.name).not.toContain("\r");
    expect(user?.name).not.toContain("\t");
    expect(user?.name?.length).toBeLessThanOrEqual(60);
    expect(user?.name).toBe(user?.name?.trim());
  });

  it("segunda assinatura do mesmo aluno cria segunda linha (1:N)", async () => {
    const e1 = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "duas-subs@test.com", subscriberCode: "SUB-P11a" }),
      e1.env,
    );
    const e2 = testEnv();
    await postWebhook(
      app,
      purchaseApproved({ email: "duas-subs@test.com", subscriberCode: "SUB-P11b" }),
      e2.env,
    );

    const user = await findUserByEmail(db(), "duas-subs@test.com");
    const a = await findSubscriptionByCode(db(), "SUB-P11a");
    const b = await findSubscriptionByCode(db(), "SUB-P11b");

    expect(a?.userId).toBe(user!.id);
    expect(b?.userId).toBe(user!.id);
  });
});

describe("PURCHASE_APPROVED com tombstone", () => {
  it("renovação de conta excluída é ignorada e não recria o usuário", async () => {
    const { sent, env: e } = testEnv();
    await markDeleted(db(), await hashOf("excluido@test.com"));

    await postWebhook(
      app,
      purchaseApproved({
        email: "excluido@test.com",
        subscriberCode: "SUB-P12",
        recurrenceNumber: 2,
      }),
      e,
    );

    expect(await findUserByEmail(db(), "excluido@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("compra NOVA limpa a tombstone e provisiona como cliente novo", async () => {
    const { sent, env: e } = testEnv();
    await markDeleted(db(), await hashOf("voltou@test.com"));

    await postWebhook(
      app,
      purchaseApproved({
        email: "voltou@test.com",
        subscriberCode: "SUB-P13",
        recurrenceNumber: 1,
      }),
      e,
    );

    expect(await findUserByEmail(db(), "voltou@test.com")).toBeDefined();
    expect(await isDeleted(db(), await hashOf("voltou@test.com"))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
