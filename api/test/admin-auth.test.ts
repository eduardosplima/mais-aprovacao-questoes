import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/app";
import { getDb } from "../src/db/client";
import { upsertAdmin, findAdmin, deleteAdmin } from "../src/db/admins";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { signAdminSession } from "../src/lib/jwt";
import { envWith, cookieFrom } from "./helpers";

const ADMIN = "admin@test.com"; // o mesmo de ADMIN_EMAILS no vitest.config
const FORA = "fora-da-lista@test.com";
const SENHA = "senha-de-doze-ou-mais";

/** Bypass ligado: o email do Access vem de ACCESS_DEV_EMAIL. */
const comoAccess = (email: string) =>
  envWith({ ACCESS_DEV_BYPASS: "true", ACCESS_DEV_EMAIL: email });

async function cookieDe(email: string): Promise<string> {
  return `sessao_admin=${await signAdminSession(email, env.JWT_SECRET)}`;
}

beforeEach(async () => {
  await deleteAdmin(getDb(env), ADMIN);
  await deleteAdmin(getDb(env), FORA);
});

describe("GET /admin/auth/contexto", () => {
  it("email na allowlist e sem senha: ehAdmin true, temSenha false", async () => {
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(ADMIN));
    expect(await res.json()).toEqual({
      email: ADMIN,
      ehAdmin: true,
      temSenha: false,
    });
  });

  it("com senha cadastrada, temSenha vira true", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(ADMIN));
    expect(await res.json()).toMatchObject({ ehAdmin: true, temSenha: true });
  });

  it("email fora da allowlist: ehAdmin false", async () => {
    const res = await app.request("/admin/auth/contexto", {}, comoAccess(FORA));
    expect(await res.json()).toMatchObject({ email: FORA, ehAdmin: false });
  });
});

describe("POST /admin/auth/login", () => {
  async function entrar(body: unknown, email = ADMIN) {
    return app.request(
      "/admin/auth/login",
      { method: "POST", body: JSON.stringify(body) },
      comoAccess(email),
    );
  }

  it("senha certa emite o cookie sessao_admin", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await entrar({ senha: SENHA });
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "sessao_admin")).toBeTruthy();
  });

  it("senha errada é 401 e não emite cookie", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await entrar({ senha: "errada-mas-longa" });
    expect(res.status).toBe(401);
    expect(cookieFrom(res, "sessao_admin")).toBeNull();
  });

  it("email fora da allowlist é 403 mesmo com senha cadastrada", async () => {
    await upsertAdmin(getDb(env), FORA, await hashPassword(SENHA));
    const res = await entrar({ senha: SENHA }, FORA);
    expect(res.status).toBe(403);
  });

  it("sem linha em admins é 401", async () => {
    const res = await entrar({ senha: SENHA });
    expect(res.status).toBe(401);
  });

  // A invariante da spec §5: não existe caminho pelo qual o cliente escolha
  // de quem é a senha que está sendo conferida.
  it("email no corpo é ignorado", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    await upsertAdmin(getDb(env), FORA, await hashPassword("outra-senha-longa"));
    const res = await entrar({ senha: "outra-senha-longa", email: FORA });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/auth/me", () => {
  it("devolve o email do Access, não o do cookie", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    const res = await app.request(
      "/admin/auth/me",
      { headers: { cookie: await cookieDe(ADMIN) } },
      comoAccess(ADMIN),
    );
    expect(await res.json()).toEqual({ email: ADMIN });
  });

  it("401 quando o cookie é de um email e o Access é de outro", async () => {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    await upsertAdmin(getDb(env), FORA, await hashPassword(SENHA));
    const res = await app.request(
      "/admin/auth/me",
      { headers: { cookie: await cookieDe(FORA) } },
      comoAccess(ADMIN),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/auth/senha", () => {
  async function trocar(body: unknown) {
    await upsertAdmin(getDb(env), ADMIN, await hashPassword(SENHA));
    return app.request(
      "/admin/auth/senha",
      {
        method: "POST",
        headers: { cookie: await cookieDe(ADMIN) },
        body: JSON.stringify(body),
      },
      comoAccess(ADMIN),
    );
  }

  it("troca a senha quando a atual confere", async () => {
    const res = await trocar({ senhaAtual: SENHA, nova: "nova-senha-comprida" });
    expect(res.status).toBe(200);
    const linha = await findAdmin(getDb(env), ADMIN);
    expect(await verifyPassword("nova-senha-comprida", linha!.passwordHash)).toBe(
      true,
    );
  });

  it("senha atual errada é 400 e não troca nada", async () => {
    const res = await trocar({ senhaAtual: "nao-e-essa", nova: "nova-senha-comprida" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "senha_atual_incorreta" });
    const linha = await findAdmin(getDb(env), ADMIN);
    expect(await verifyPassword(SENHA, linha!.passwordHash)).toBe(true);
  });

  it("nova senha com menos de 12 caracteres é 400", async () => {
    const res = await trocar({ senhaAtual: SENHA, nova: "curta12345" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "weak_password" });
  });

  // A troca de senha carimba `updated_at`, e requireSessaoAdmin passa a
  // recusar sessão anterior a ele — inclusive a de quem acabou de trocar. Por
  // isso a rota reemite o cookie: quem troca continua dentro, quem roubou sai.
  it("reemite o cookie de sessão, e o novo continua valendo", async () => {
    const res = await trocar({ senhaAtual: SENHA, nova: "nova-senha-comprida" });
    expect(res.status).toBe(200);
    const novo = cookieFrom(res, "sessao_admin");
    expect(novo).toBeTruthy();

    const depois = await app.request(
      "/admin/auth/me",
      { headers: { cookie: novo! } },
      comoAccess(ADMIN),
    );
    expect(depois.status).toBe(200);
  });

  it("sem sessão é 401", async () => {
    const res = await app.request(
      "/admin/auth/senha",
      { method: "POST", body: JSON.stringify({ senhaAtual: SENHA, nova: "x".repeat(12) }) },
      comoAccess(ADMIN),
    );
    expect(res.status).toBe(401);
  });
});
