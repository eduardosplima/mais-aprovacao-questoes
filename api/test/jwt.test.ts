import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  signSession,
  verifySession,
  signAdminSession,
  verifyAdminSession,
} from "../src/lib/jwt";

const secret = "s3cr3t";

describe("jwt de sessão", () => {
  it("assina e verifica, recuperando o userId", async () => {
    const token = await signSession("user-123", secret);
    expect(await verifySession(token, secret)).toBe("user-123");
  });

  it("rejeita token com segredo errado", async () => {
    const token = await signSession("user-123", secret);
    expect(await verifySession(token, "outro")).toBeNull();
  });

  it("rejeita lixo", async () => {
    expect(await verifySession("nao-e-um-jwt", secret)).toBeNull();
  });
});

describe("sessão de admin", () => {
  it("ida e volta devolve o email e o iat", async () => {
    const antes = Math.floor(Date.now() / 1000);
    const t = await signAdminSession("admin@test.com", "s");
    const sessao = await verifyAdminSession(t, "s");
    expect(sessao?.email).toBe("admin@test.com");
    expect(sessao?.iat).toBeGreaterThanOrEqual(antes);
  });

  it("segredo errado devolve null", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifyAdminSession(t, "outro")).toBeNull();
  });

  // Os dois cookies vivem em hostnames diferentes em produção, mas dividem
  // localhost em desenvolvimento. O `typ` é o que impede um valer pelo outro.
  it("token de aluno não passa por sessão de admin", async () => {
    const t = await signSession("id-de-usuario", "s");
    expect(await verifyAdminSession(t, "s")).toBeNull();
  });

  it("token de admin não passa por sessão de aluno", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifySession(t, "s")).toBeNull();
  });

  // Sem `iat` não dá para comparar a sessão com a última troca de senha, e
  // uma sessão que não dá para comparar não pode ser aceita.
  it("token de admin sem iat devolve null", async () => {
    const t = await new SignJWT({ typ: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin@test.com")
      .setExpirationTime("12h")
      .sign(new TextEncoder().encode("s"));
    expect(await verifyAdminSession(t, "s")).toBeNull();
  });
});
