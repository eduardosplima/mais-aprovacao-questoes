import { Hono } from "hono";
import type { Env } from "../config/env";

export const media = new Hono<{ Bindings: Env }>();

/**
 * Leitura pública do bucket, e ela só existe para o desenvolvimento local.
 *
 * Em produção quem serve as imagens é o Custom Domain do R2
 * (media.maisaprovacao.com.br) — um hostname sem cookies, que é o que a spec
 * exige para um SVG malicioso não poder executar com a sessão do admin. Esta
 * rota nunca é alcançada lá: nenhuma das três Worker Routes de
 * `wrangler.jsonc` casa /media/*, e workers_dev e preview_urls estão ambos em
 * false. É o mesmo arranjo do /health — existe no Hono, não é roteada na
 * borda.
 *
 * Fica fora do app.use("/admin/*") de propósito: um <img> não manda o JWT do
 * Access, e o conteúdo aqui é o mesmo que o bucket já serve publicamente em
 * produção. `test/media.test.ts` afirma essa ausência.
 *
 * A chave gravada no upload é `media/<uuid>.<ext>` (routes/admin/media.ts) e
 * a URL persistida repete esse segmento, então ele é reconstruído aqui.
 * Travessia de caminho não se aplica: o `:key` do Hono casa um segmento só,
 * então `/` não passa, e chave de R2 é string plana, sem semântica de
 * diretório.
 */
media.get("/:key", async (c) => {
  const obj = await c.env.MEDIA.get(`media/${c.req.param("key")}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    },
  });
});
