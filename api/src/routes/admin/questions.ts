import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env";
import type { Entitlement } from "../../db/users";
import { getDb } from "../../db/client";
import {
  createQuestion,
  getQuestion,
  listQuestions,
  setStatus,
  softDeleteQuestion,
  updateQuestion,
  type QuestionInput,
  type QuestionStatus,
} from "../../db/questions";

export const adminQuestions = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

/**
 * Um link de vídeo é http ou https e nada mais.
 *
 * Não reusa `isSafeUrl`: aquela função existe para `href` de conteúdo, onde
 * `mailto:` e caminho relativo são legítimos — num campo de vídeo não são.
 *
 * Cloudflare Stream (spec técnica §7.2) é o que o campo significa, não o que
 * ele verifica: a allowlist de hostname precisaria do código da conta
 * (`customer-<código>.cloudflarestream.com`), e o Stream ainda não foi
 * provisionado. Quando for, aperta-se aqui.
 */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Não é URL absoluta — caminho relativo, âncora, texto solto.
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

const alternativeSchema = z.object({
  body: z.string().min(1),
  isCorrect: z.boolean(),
});

// Intervalo de ano aceito, compartilhado entre a validação de escrita
// (schema Zod) e o filtro de listagem — duas checagens diferentes, um só
// intervalo, para uma não poder divergir da outra ao ser ajustado.
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const questionSchema = z.object({
  type: z.enum(["multiple_choice", "true_false"]),
  statement: z.string().min(1),
  subjectId: z.string().min(1),
  bancaId: z.string().min(1),
  cargoId: z.string().nullish(),
  levelId: z.string().nullish(),
  year: z.number().int().min(MIN_YEAR).max(MAX_YEAR).nullish(),
  alternatives: z.array(alternativeSchema).min(1).max(10),
  explanation: z.object({
    body: z.string().min(1),
    videoUrl: z
      .string()
      .refine(isHttpUrl, { message: "videoUrl precisa ser http ou https" })
      .nullish(),
  }),
});

/**
 * Só na criação. "Salvar rascunho" e "Publicar" são a mesma chamada — é o
 * "cadastro em um step" da spec §2.
 *
 * Deliberadamente um schema separado, não um campo em `questionSchema`: as duas
 * rotas compartilham aquele objeto, e um `status` com default nele faria todo
 * PATCH carregar `status: "draft"` e despublicar em silêncio a questão que
 * alguém só quis corrigir. O PATCH fica com o schema base, que não tem o campo.
 */
const createSchema = questionSchema.extend({
  status: z.enum(["draft", "published"]).default("draft"),
});

/**
 * `not_found` é 404; todo o resto é falha de regra de negócio (invariante de
 * alternativa correta, `kind` cruzado de taxonomia) e vira 422 com o código,
 * para o painel poder exibir a mensagem específica.
 */
const statusFor = (error: string): 404 | 422 =>
  error === "not_found" ? 404 : 422;

// Só é um valor válido de paginação o inteiro dentro de [min, max]; qualquer
// outra coisa (negativo, fracionário, NaN, texto, ou grande demais a ponto
// do JS serializar em notação científica e quebrar o bind do D1) cai no
// default. É uma checagem de pertencimento ao intervalo, não uma lista de
// exceções — não precisa crescer a cada novo formato inválido descoberto.
function parseInRange(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

const MAX_LIMIT = 200;
// Teto de offset para paginação do acervo de questões: mesmo num cenário
// improvável de milhões de questões cadastradas, um offset além de 1 milhão
// não faz sentido para uma listagem administrativa paginada — e fica bem
// abaixo da ordem de grandeza (~1e21) em que o JS passa a serializar números
// em notação científica (`"1e+21"`), formato que o bind do D1 recusa.
const MAX_OFFSET = 1_000_000;

function parseLimit(raw: string | undefined): number {
  return parseInRange(raw, 1, MAX_LIMIT, 50);
}

function parseOffset(raw: string | undefined): number {
  return parseInRange(raw, 0, MAX_OFFSET, 0);
}

// Valor vazio (ou só espaço) de filtro é "sem filtro", em todo campo — é o
// que um <select><option value=""> manda quando o operador limpa o filtro.
// Sem essa normalização, um filtro limpo do jeito que o painel manda seria
// indistinguível de um filtro malformado.
function emptyToUndefined(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === "" ? undefined : raw;
}

// Filtro inválido (não vazio, mas errado) responde 400; paginação inválida
// cai no default. O critério não é "validado ou não", é se descartar em
// silêncio muda o que o operador acredita estar vendo: um filtro descartado
// faz a tela mostrar o acervo inteiro dizendo que filtrou, um `limit`
// clampado não mente sobre o conteúdo.
//
// Os ids de taxonomia ficam de fora dos dois lados: são opacos, e um id
// inexistente já devolve lista vazia — a resposta honesta tanto para
// "malformado" quanto para "não existe".
adminQuestions.get("/", async (c) => {
  const q = c.req.query();

  const statusRaw = emptyToUndefined(q.status);
  let status: QuestionStatus | undefined;
  if (statusRaw !== undefined) {
    if (statusRaw !== "draft" && statusRaw !== "published") {
      return c.json({ error: "invalid_status" }, 400);
    }
    status = statusRaw;
  }

  const yearRaw = emptyToUndefined(q.year);
  let year: number | undefined;
  if (yearRaw !== undefined) {
    // Mesmo teste de pertencimento a intervalo que `parseInRange` usa, com os
    // limites do schema de escrita.
    const n = Number(yearRaw);
    if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) {
      return c.json({ error: "invalid_year" }, 400);
    }
    year = n;
  }

  const result = await listQuestions(getDb(c.env), {
    subjectId: emptyToUndefined(q.subjectId),
    bancaId: emptyToUndefined(q.bancaId),
    cargoId: emptyToUndefined(q.cargoId),
    levelId: emptyToUndefined(q.levelId),
    year,
    status,
    limit: parseLimit(q.limit),
    offset: parseOffset(q.offset),
  });
  return c.json(result);
});

adminQuestions.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const res = await createQuestion(
    getDb(c.env),
    parsed.data as QuestionInput,
    c.get("entitlement")?.userId ?? null,
    parsed.data.status,
  );
  if ("error" in res) return c.json({ error: res.error }, statusFor(res.error));
  return c.json({ id: res.id }, 201);
});

adminQuestions.get("/:id", async (c) => {
  const question = await getQuestion(getDb(c.env), c.req.param("id"));
  if (!question) return c.json({ error: "not_found" }, 404);
  return c.json({ question });
});

adminQuestions.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const res = await updateQuestion(
    getDb(c.env),
    c.req.param("id"),
    parsed.data as QuestionInput,
  );
  if ("error" in res) return c.json({ error: res.error }, statusFor(res.error));
  return c.json({ ok: true });
});

adminQuestions.post("/:id/publish", async (c) => {
  const ok = await setStatus(getDb(c.env), c.req.param("id"), "published");
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminQuestions.post("/:id/unpublish", async (c) => {
  const ok = await setStatus(getDb(c.env), c.req.param("id"), "draft");
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminQuestions.delete("/:id", async (c) => {
  const ok = await softDeleteQuestion(getDb(c.env), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
