import { describe, it, expect } from "vitest";
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
  it("ida e volta devolve o email", async () => {
    const t = await signAdminSession("admin@test.com", "s");
    expect(await verifyAdminSession(t, "s")).toBe("admin@test.com");
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
});
