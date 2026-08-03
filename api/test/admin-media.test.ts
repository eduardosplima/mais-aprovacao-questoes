import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/config/env";
import { detectImageType } from "../src/lib/magicBytes";
import { adminMedia } from "../src/routes/admin/media";
import { envWith } from "./helpers";

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/admin/media", adminMedia);
  return a;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const SVG = new TextEncoder().encode('<svg onload="alert(1)"></svg>');

function upload(bytes: Uint8Array, filename: string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  return { method: "POST", body: form };
}

describe("detectImageType", () => {
  it("reconhece PNG, JPEG e GIF pelos magic bytes", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(GIF)).toBe("image/gif");
  });

  it("recusa SVG, que é o vetor de XSS em upload de imagem", () => {
    expect(detectImageType(SVG)).toBeNull();
  });

  it("recusa bytes que não são imagem", () => {
    expect(detectImageType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("rota de upload", () => {
  it("aceita PNG e devolve URL pública", async () => {
    const res = await app().request(
      "/admin/media",
      upload(PNG, "foto.png", "image/png"),
      env,
    );
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith("https://media.test/media/")).toBe(true);
    expect(url.endsWith(".png")).toBe(true);
  });

  it("grava no bucket sob o prefixo media/", async () => {
    const res = await app().request(
      "/admin/media",
      upload(PNG, "foto.png", "image/png"),
      env,
    );
    const { url } = (await res.json()) as { url: string };
    const key = url.replace("https://media.test/", "");
    expect(await env.MEDIA.head(key)).toBeTruthy();
  });

  // O Content-Type declarado é do cliente e não vale nada.
  it("recusa SVG disfarçado de PNG no Content-Type", async () => {
    const res = await app().request(
      "/admin/media",
      upload(SVG, "malicioso.png", "image/png"),
      env,
    );
    expect(res.status).toBe(415);
  });

  it("o nome do arquivo do usuário nunca vira a chave", async () => {
    const res = await app().request(
      "/admin/media",
      upload(PNG, "../../etc/passwd.png", "image/png"),
      env,
    );
    const { url } = (await res.json()) as { url: string };
    expect(url).not.toContain("..");
    expect(url).not.toContain("passwd");
  });

  // A URL é persistida no statement da questão pelo editor — uma barra
  // duplicada quebra o link já salvo, mesmo que a var seja corrigida depois.
  it("normaliza a barra final de MEDIA_PUBLIC_BASE, sem gerar // na URL", async () => {
    const res = await app().request(
      "/admin/media",
      upload(PNG, "foto.png", "image/png"),
      envWith({ MEDIA_PUBLIC_BASE: "https://media.test/" }),
    );
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith("https://media.test/media/")).toBe(true);
    expect(url).not.toContain("//media/");
  });

  it("400 sem arquivo no formulário", async () => {
    const res = await app().request("/admin/media", { method: "POST", body: new FormData() }, env);
    expect(res.status).toBe(400);
  });

  it("413 acima do tamanho máximo", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(PNG.slice(0, 8));
    const res = await app().request("/admin/media", upload(big, "g.png", "image/png"), env);
    expect(res.status).toBe(413);
  });
});
