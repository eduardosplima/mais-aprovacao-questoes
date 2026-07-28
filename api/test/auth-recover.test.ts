import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { authTokens } from "../src/db/schema";
import { upsertUserFromPurchase } from "../src/db/users";
import { markDeleted } from "../src/db/deletedAccounts";
import { hmacHex, normalizeDocument } from "../src/lib/hmac";
import { fakeEmailSender, envWith, cookieFrom } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOC = "123.456.789-09";

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Stub que aprova o Turnstile e deixa o resto do fetch estourar. */
function stubCaptcha(success = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === TURNSTILE_URL) {
        return new Response(JSON.stringify({ success }), { status: 200 });
      }
      throw new Error("fetch inesperado: " + String(input));
    }),
  );
}

async function alunoComDocumento(email: string, doc: string | null) {
  return upsertUserFromPurchase(
    db(),
    {
      email,
      name: "Aluno",
      documentHash: doc
        ? await hmacHex(normalizeDocument(doc), env.DOCUMENT_HMAC_KEY)
        : null,
    },
    [],
  );
}

function recover(
  e: Cloudflare.Env,
  email: string,
  document: string,
  turnstileToken = "tok",
) {
  return app.request(
    "/auth/recover",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, document, turnstileToken }),
    },
    e,
  );
}

async function tokensDe(userId: string) {
  return db()
    .select()
    .from(authTokens)
    .where(eq(authTokens.userId, userId))
    .all();
}

describe("POST /auth/recover", () => {
  it("dados corretos: 200 e envia o link de recuperação", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec1@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec1@test.com", DOC);

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("rec1@test.com");
    expect(sent[0].subject.toLowerCase()).toContain("recupera");
    expect(await tokensDe(id)).toHaveLength(1);
  });

  it("email inexistente: 200 idêntico, sem email enviado", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();

    const ok = await recover(envWith({ EMAIL: sender }), "nao-existe@test.com", DOC);

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("documento errado: 200 idêntico, sem email enviado", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec2@test.com", DOC);

    const res = await recover(
      envWith({ EMAIL: sender }),
      "rec2@test.com",
      "999.999.999-99",
    );

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await tokensDe(id)).toHaveLength(0);
  });

  it("aceita o documento com ou sem máscara", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec3@test.com", DOC);

    await recover(envWith({ EMAIL: sender }), "rec3@test.com", "12345678909");
    expect(sent).toHaveLength(1);
  });

  it("usuário sem documento cadastrado: valida só o email", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec4@test.com", null);

    await recover(
      envWith({ EMAIL: sender }),
      "rec4@test.com",
      "qualquer-documento",
    );
    expect(sent).toHaveLength(1);
  });

  it("cooldown: segunda chamada em 5 min não emite token novo", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    const id = await alunoComDocumento("rec5@test.com", DOC);
    const e = envWith({ EMAIL: sender });

    await recover(e, "rec5@test.com", DOC);
    const segunda = await recover(e, "rec5@test.com", DOC);

    expect(segunda.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(await tokensDe(id)).toHaveLength(1);
  });

  it("conta excluída: 200 idêntico, sem email", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec6@test.com", DOC);
    await markDeleted(db(), await hmacHex("rec6@test.com", env.DOCUMENT_HMAC_KEY));

    const res = await recover(envWith({ EMAIL: sender }), "rec6@test.com", DOC);

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("Finding 2: envio falha com email+CPF corretos ainda devolve 200 genérico (sem oráculo de CPF)", async () => {
    stubCaptcha();
    const failingSender = {
      async send() {
        throw new Error("smtp indisponível");
      },
    };
    await alunoComDocumento("rec-falha@test.com", DOC);

    const res = await recover(
      envWith({ EMAIL: failingSender }),
      "rec-falha@test.com",
      DOC,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("403 quando o Turnstile reprova", async () => {
    stubCaptcha(false);
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec7@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec7@test.com", DOC);

    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("nunca emite sessão", async () => {
    stubCaptcha();
    const { sender } = fakeEmailSender();
    await alunoComDocumento("rec8@test.com", DOC);

    const res = await recover(envWith({ EMAIL: sender }), "rec8@test.com", DOC);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com corpo malformado", async () => {
    stubCaptcha();
    const { sender } = fakeEmailSender();
    const res = await app.request(
      "/auth/recover",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@test.com" }),
      },
      envWith({ EMAIL: sender }),
    );
    expect(res.status).toBe(400);
  });

  it("o token gerado serve para definir a senha", async () => {
    stubCaptcha();
    const { sent, sender } = fakeEmailSender();
    await alunoComDocumento("rec9@test.com", DOC);

    await recover(envWith({ EMAIL: sender }), "rec9@test.com", DOC);

    const match = sent[0].text.match(/token=([A-Za-z0-9_%-]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const res = await app.request(
      "/auth/set-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "nova-senha-forte" }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });
});
