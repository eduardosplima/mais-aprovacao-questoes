import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { getDb } from "../src/db/client";
import { reconcile } from "../src/jobs/reconcile";
import { upsertUserFromPurchase, findUserByEmail } from "../src/db/users";
import {
  upsertSubscription,
  findSubscriptionByCode,
} from "../src/db/subscriptions";
import { markDeleted } from "../src/db/deletedAccounts";
import { hmacHex } from "../src/lib/hmac";
import { fakeEmailSender, envWith } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

function apiItem(overrides: Record<string, unknown> = {}) {
  return {
    subscriber_code: "SUB-REC-1",
    status: "ACTIVE",
    date_next_charge: Date.now() + 30 * 86400000,
    plan: { name: "Mensal" },
    product: { ucode: "UCODE_ASSINATURA" },
    subscriber: { name: "Aluno Rec", email: "rec-api@test.com" },
    ...overrides,
  };
}

/** Stub do token + de uma única página de assinaturas. */
function stubHotmart(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === env.HOTMART_TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: "AT" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ items }), { status: 200 });
    }),
  );
}

async function assinaturaNoBanco(
  email: string,
  code: string,
  accessUntil: Date | null,
  status = "ACTIVE",
) {
  const userId = await upsertUserFromPurchase(
    db(),
    { email, name: "Aluno", documentHash: null },
    [],
  );
  await upsertSubscription(db(), {
    subscriberCode: code,
    userId,
    productUcode: "UCODE_ASSINATURA",
    planName: "Mensal",
    status,
    accessUntil,
    lastTransaction: null,
  });
  return userId;
}

describe("reconcile — webhook de compra perdido", () => {
  it("cria o usuário ausente e envia o link mágico", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-NOVO",
        subscriber: { name: "Perdido", email: "perdido@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const user = await findUserByEmail(db(), "perdido@test.com");
    expect(user).toBeDefined();
    expect(user?.name).toBe("Perdido");
    expect(user?.documentHash).toBeNull(); // a API não devolve documento

    const sub = await findSubscriptionByCode(db(), "SUB-REC-NOVO");
    expect(sub?.userId).toBe(user!.id);

    expect(sent).toHaveLength(1);
    expect(stats.created).toBe(1);
  });

  it("não reenvia link se já existe token pendente", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-PEND",
        subscriber: { name: null, email: "pendente-rec@test.com" },
      }),
    ]);

    const primeira = fakeEmailSender();
    await reconcile(envWith({ EMAIL: primeira.sender }));
    expect(primeira.sent).toHaveLength(1);

    // a assinatura agora existe, então este caso vira "corrected"; o teste
    // garante que nenhum segundo email sai
    const segunda = fakeEmailSender();
    await reconcile(envWith({ EMAIL: segunda.sender }));
    expect(segunda.sent).toHaveLength(0);
  });
});

describe("reconcile — correção de datas", () => {
  it("corrige access_until divergente", async () => {
    const correto = Date.now() + 45 * 86400000;
    await assinaturaNoBanco(
      "corrige@test.com",
      "SUB-REC-CORR",
      new Date(Date.now() + 7 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-CORR",
        date_next_charge: correto,
        subscriber: { name: "Aluno", email: "corrige@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-CORR");
    expect(sub?.accessUntil?.getTime()).toBe(correto);
    expect(stats.corrected).toBe(1);
  });

  it("não conta correção quando a data já está certa", async () => {
    const data = Date.now() + 20 * 86400000;
    await assinaturaNoBanco("igual@test.com", "SUB-REC-IGUAL", new Date(data));
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-IGUAL",
        date_next_charge: data,
        subscriber: { name: "Aluno", email: "igual@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    expect((await reconcile(envWith({ EMAIL: sender }))).corrected).toBe(0);
  });

  it("cancelada com data futura mantém acesso até o fim do ciclo pago", async () => {
    const fimDoCiclo = Date.now() + 12 * 86400000;
    await assinaturaNoBanco(
      "cancel-rec@test.com",
      "SUB-REC-CANC",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-CANC",
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: fimDoCiclo,
        subscriber: { name: "Aluno", email: "cancel-rec@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-CANC");
    expect(sub?.accessUntil?.getTime()).toBe(fimDoCiclo);
  });
});

describe("reconcile — revogação", () => {
  it("revoga quando a data já passou", async () => {
    await assinaturaNoBanco(
      "revoga@test.com",
      "SUB-REC-REV",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-REV",
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: Date.now() - 86400000,
        subscriber: { name: "Aluno", email: "revoga@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-REV");
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(stats.revoked).toBe(1);
  });

  it("revoga status não-ativo sem data", async () => {
    await assinaturaNoBanco(
      "inativo@test.com",
      "SUB-REC-INAT",
      new Date(Date.now() + 40 * 86400000),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-INAT",
        status: "INACTIVE",
        date_next_charge: undefined,
        subscriber: { name: "Aluno", email: "inativo@test.com" },
      }),
    ]);
    const { sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-INAT");
    expect(sub!.accessUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("reconcile — REGRA DURA: ausência nunca revoga", () => {
  it("assinatura no D1 e ausente na API permanece intocada", async () => {
    const acesso = new Date(Date.now() + 40 * 86400000);
    await assinaturaNoBanco("fantasma@test.com", "SUB-REC-AUSENTE", acesso);

    stubHotmart([]); // a API não devolve nada
    const { sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    const sub = await findSubscriptionByCode(db(), "SUB-REC-AUSENTE");
    expect(sub?.accessUntil?.getTime()).toBe(acesso.getTime());
    expect(sub?.status).toBe("ACTIVE");
    expect(stats.revoked).toBe(0);
    expect(stats.missingInApi).toBeGreaterThan(0);
  });

  it("propaga o erro quando a API falha, sem tocar em nada", async () => {
    const acesso = new Date(Date.now() + 40 * 86400000);
    await assinaturaNoBanco("erro-api@test.com", "SUB-REC-ERRO", acesso);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === env.HOTMART_TOKEN_URL) {
          return new Response(JSON.stringify({ access_token: "AT" }));
        }
        return new Response("boom", { status: 500 });
      }),
    );
    const { sender } = fakeEmailSender();

    await expect(reconcile(envWith({ EMAIL: sender }))).rejects.toThrow();

    const sub = await findSubscriptionByCode(db(), "SUB-REC-ERRO");
    expect(sub?.accessUntil?.getTime()).toBe(acesso.getTime());
  });
});

describe("reconcile — filtros", () => {
  it("ignora assinatura de produto fora dos ucodes configurados", async () => {
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-OUTRO",
        product: { ucode: "UCODE_DE_OUTRO_PRODUTO" },
        subscriber: { name: "Outro", email: "outro-produto@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    await reconcile(envWith({ EMAIL: sender }));

    expect(await findUserByEmail(db(), "outro-produto@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("pula email na tombstone e NÃO recria a conta excluída", async () => {
    await markDeleted(
      db(),
      await hmacHex("excluido-rec@test.com", env.DOCUMENT_HMAC_KEY),
    );
    stubHotmart([
      apiItem({
        subscriber_code: "SUB-REC-TOMB",
        // assinatura cancelada continua listada com data futura — é
        // exatamente o caso que desfaria a exclusão sem a tombstone
        status: "CANCELLED_BY_CUSTOMER",
        date_next_charge: Date.now() + 20 * 86400000,
        subscriber: { name: "Excluído", email: "excluido-rec@test.com" },
      }),
    ]);
    const { sent, sender } = fakeEmailSender();

    const stats = await reconcile(envWith({ EMAIL: sender }));

    expect(await findUserByEmail(db(), "excluido-rec@test.com")).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(stats.skipped).toBe(1);
  });
});
