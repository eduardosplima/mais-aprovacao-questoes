import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import app from "../src/app";
import { getDb } from "../src/db/client";
import { upsertUserFromPurchase, setPasswordHash } from "../src/db/users";
import { upsertSubscription } from "../src/db/subscriptions";
import { hashPassword } from "../src/lib/password";
import { stubTurnstile, cookieFrom } from "./helpers";

const db = () => getDb(env);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function alunoComSenha(email: string, senha: string): Promise<string> {
  const id = await upsertUserFromPurchase(db(), {
    email,
    name: "Aluno",
    documentHash: null,
  });
  await setPasswordHash(db(), id, await hashPassword(senha));
  return id;
}

function login(email: string, password: string, turnstileToken = "tok") {
  return app.request(
    "/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, turnstileToken }),
    },
    env,
  );
}

describe("POST /auth/login", () => {
  it("autentica com a senha correta e emite a sessão", async () => {
    stubTurnstile(true);
    await alunoComSenha("login1@test.com", "senha-correta");

    const res = await login("login1@test.com", "senha-correta");
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "session")).toBeTruthy();
  });

  it("aceita email com espaços e maiúsculas", async () => {
    stubTurnstile(true);
    await alunoComSenha("login2@test.com", "senha-correta");

    const res = await login("  Login2@TEST.com  ", "senha-correta");
    expect(res.status).toBe(200);
  });

  it("401 genérico com senha errada", async () => {
    stubTurnstile(true);
    await alunoComSenha("login3@test.com", "senha-correta");

    const res = await login("login3@test.com", "senha-errada");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("401 IDÊNTICO para usuário inexistente (anti-enumeração)", async () => {
    stubTurnstile(true);
    await alunoComSenha("login4@test.com", "senha-correta");

    const errada = await login("login4@test.com", "senha-errada");
    const inexistente = await login("nao-existe@test.com", "qualquer-senha");

    expect(inexistente.status).toBe(errada.status);
    expect(await inexistente.json()).toEqual(await errada.json());
  });

  it("401 para usuário que nunca definiu senha", async () => {
    stubTurnstile(true);
    await upsertUserFromPurchase(db(), {
      email: "sem-senha@test.com",
      name: null,
      documentHash: null,
    });

    const res = await login("sem-senha@test.com", "qualquer-senha");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("403 quando o Turnstile reprova, sem sequer olhar a senha", async () => {
    stubTurnstile(false);
    await alunoComSenha("login5@test.com", "senha-correta");

    const res = await login("login5@test.com", "senha-correta");
    expect(res.status).toBe(403);
    expect(cookieFrom(res, "session")).toBeNull();
  });

  it("400 com corpo malformado", async () => {
    stubTurnstile(true);
    const res = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "não é json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("gasta tempo comparável em usuário inexistente (sem oráculo de tempo)", async () => {
    stubTurnstile(true);
    await alunoComSenha("login6@test.com", "senha-correta");

    const t0 = Date.now();
    await login("login6@test.com", "senha-errada");
    const comUsuario = Date.now() - t0;

    const t1 = Date.now();
    await login("nao-existe-nenhum@test.com", "senha-errada");
    const semUsuario = Date.now() - t1;

    // Se o caminho "sem usuário" pulasse o PBKDF2, seria ordens de grandeza
    // mais rápido. Margem generosa: o teste trava a intenção, não a latência.
    expect(semUsuario).toBeGreaterThan(comUsuario / 5);
  });
});

describe("GET /auth/me", () => {
  it("401 sem cookie", async () => {
    const res = await app.request("/auth/me", {}, env);
    expect(res.status).toBe(401);
  });

  it("401 com cookie inválido", async () => {
    const res = await app.request(
      "/auth/me",
      { headers: { cookie: "session=lixo" } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("devolve o perfil e o tier derivado da assinatura", async () => {
    stubTurnstile(true);
    const id = await alunoComSenha("me1@test.com", "senha-correta");
    await upsertSubscription(db(), {
      subscriberCode: "SUB-ME-1",
      userId: id,
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      status: "ACTIVE",
      accessUntil: new Date(Date.now() + 86400000),
      lastTransaction: null,
    });

    const session = cookieFrom(await login("me1@test.com", "senha-correta"), "session")!;
    const me = await app.request("/auth/me", { headers: { cookie: session } }, env);

    expect(await me.json()).toEqual({
      id,
      email: "me1@test.com",
      name: "Aluno",
      tier: "assinante",
    });
  });

  // Uma compra com email de admin cria uma conta de ALUNO, e é só isso que
  // ela cria (spec §3). O painel não olha para `users`.
  it("/auth/me não devolve role", async () => {
    stubTurnstile(true);
    await alunoComSenha("admin@test.com", "senha-correta");

    const session = cookieFrom(
      await login("admin@test.com", "senha-correta"),
      "session",
    )!;
    const res = await app.request(
      "/auth/me",
      { headers: { cookie: session } },
      env,
    );

    expect(await res.json()).not.toHaveProperty("role");
  });
});

describe("POST /auth/logout", () => {
  it("limpa o cookie de sessão", async () => {
    const res = await app.request("/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
  });
});
