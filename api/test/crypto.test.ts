import { describe, it, expect } from "vitest";
import { equalBytes, equalStrings } from "../src/lib/constantTime";
import { normalizeEmail, normalizeDocument, hmacHex } from "../src/lib/hmac";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { generateToken, hashToken } from "../src/lib/tokens";

describe("constantTime", () => {
  it("compara bytes iguais e diferentes", () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("compara strings", () => {
    expect(equalStrings("hottok-secreto", "hottok-secreto")).toBe(true);
    expect(equalStrings("hottok-secreto", "hottok-errado")).toBe(false);
    expect(equalStrings("", "")).toBe(true);
  });
});

describe("hmac", () => {
  it("normaliza email", () => {
    expect(normalizeEmail("  Aluno@Test.COM ")).toBe("aluno@test.com");
  });

  it("normaliza documento removendo tudo que não é dígito", () => {
    expect(normalizeDocument("123.456.789-09")).toBe("12345678909");
    expect(normalizeDocument("12345678909")).toBe("12345678909");
  });

  it("é determinístico e sensível à chave", async () => {
    const a = await hmacHex("12345678909", "chave-1");
    const b = await hmacHex("12345678909", "chave-1");
    const c = await hmacHex("12345678909", "chave-2");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("password", () => {
  it("gera hash no formato documentado", async () => {
    const stored = await hashPassword("senha-do-aluno");
    const parts = stored.split("$");

    expect(parts[0]).toBe("pbkdf2");
    expect(parts[1]).toBe("sha256");
    expect(parts[2]).toBe("100000");
    expect(parts).toHaveLength(5);
  });

  it("usa salt aleatório: dois hashes da mesma senha diferem", async () => {
    const a = await hashPassword("mesma-senha");
    const b = await hashPassword("mesma-senha");
    expect(a).not.toBe(b);
  });

  it("verifica a senha correta e rejeita a errada", async () => {
    const stored = await hashPassword("senha-certa");
    expect(await verifyPassword("senha-certa", stored)).toBe(true);
    expect(await verifyPassword("senha-errada", stored)).toBe(false);
  });

  it("rejeita hash malformado sem lançar", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$xyz")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$sha256$abc$a$b")).toBe(false);
  });

  it("lê a contagem de iterações da string armazenada, não da constante", async () => {
    // Gera hash com 1000 iterações (diferente da constante ITERATIONS = 100000)
    const password = "senha-para-teste";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 1000;

    // Replica a lógica de derive() para produzir um hash com iterações customizadas
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    );
    const hash = new Uint8Array(bits);

    // Constrói a string de hash manualmente
    const saltB64 = btoa(String.fromCharCode(...salt));
    const hashB64 = btoa(String.fromCharCode(...hash));
    const storedWith1000 = `pbkdf2$sha256$${iterations}$${saltB64}$${hashB64}`;

    // verifyPassword deve honrar o 1000 embutido na string
    expect(await verifyPassword(password, storedWith1000)).toBe(true);

    // Prova que a contagem de iterações realmente afeta o resultado derivado:
    // usa o MESMO salt com iterações diferentes e compara os bytes
    const bitsWith100k = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      key,
      256,
    );
    const hashWith100k = new Uint8Array(bitsWith100k);

    // Os bytes derivados com 1000 iterações devem diferir dos com 100000
    expect(hash).not.toEqual(hashWith100k);
  });
});

describe("tokens", () => {
  it("gera tokens únicos, url-safe e longos", () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("hashToken é determinístico e hex de 64 chars", async () => {
    const t = generateToken();
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t)).not.toBe(await hashToken(generateToken()));
  });
});
