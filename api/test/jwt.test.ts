import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/lib/jwt";

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
