import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/app";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("GET /media/:key", () => {
  it("devolve os bytes e o content-type gravados no upload", async () => {
    const chave = `${crypto.randomUUID()}.png`;
    await env.MEDIA.put(`media/${chave}`, PNG, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await app.request(`/media/${chave}`, {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("404 para chave que não existe", async () => {
    const res = await app.request(`/media/${crypto.randomUUID()}.png`, {}, env);
    expect(res.status).toBe(404);
  });

  it("responde sem o JWT do Cloudflare Access", async () => {
    // Este é o teste que sustenta a premissa da rota inteira: ela é
    // inalcançável em produção porque nenhuma das três Worker Routes casa
    // /media/*, e isso só continua verdade enquanto o prefixo do mount for
    // /media e não virar /admin/algo. (O app.use("/admin/*", ...) é
    // escopado por padrão de caminho, não por ordem de registro — mover o
    // app.route("/media", media) para depois dele em app.ts não mudaria
    // nada, porque /media/x nunca casa /admin/*.)
    //
    // Note que o app real é usado de propósito, e não uma mini-app montada
    // à mão como em admin-media.test.ts — montar à mão contornaria
    // justamente o middleware que se quer provar ausente.
    const chave = `${crypto.randomUUID()}.png`;
    await env.MEDIA.put(`media/${chave}`, PNG, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await app.request(`/media/${chave}`, {}, env);
    expect(res.status).toBe(200);
  });
});
