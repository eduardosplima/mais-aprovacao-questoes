import { Hono } from "hono";
import type { Env } from "../../config/env";
import { detectImageType, EXTENSION } from "../../lib/magicBytes";

export const adminMedia = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Upload avulso: a chave não referencia a questão.
 *
 * O prefixo por questão existiria para apagar as imagens junto com ela — mas
 * questão usa soft delete e nunca é apagada de verdade, então o prefixo não
 * teria função. Em troca, o upload não precisa que a questão já exista, e o
 * cadastro fica em um step.
 */
adminMedia.post("/", async (c) => {
  const form = await c.req.formData().catch(() => null);
  // O @cloudflare/workers-types instalado tipa FormData.get() como
  // `string | null` (sem File). Em runtime o Miniflare devolve o File de
  // verdade para campos de arquivo — o cast só corrige o tipo estático.
  const file = form?.get("file") as File | string | null | undefined;
  if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: "too_large" }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return c.json({ error: "unsupported_type" }, 415);

  // Nome gerado por nós: o nome do arquivo do usuário nunca toca o storage,
  // é vetor de path traversal.
  const key = `media/${crypto.randomUUID()}.${EXTENSION[type]}`;
  await c.env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: type },
  });

  // Essa URL é persistida (o painel grava no `statement` da questão): uma
  // barra final na var de ambiente não pode virar "//" no meio da URL, ou o
  // R2 responde 404 para um link que já foi salvo.
  const base = c.env.MEDIA_PUBLIC_BASE.replace(/\/+$/, "");
  return c.json({ url: `${base}/${key}` }, 201);
});
