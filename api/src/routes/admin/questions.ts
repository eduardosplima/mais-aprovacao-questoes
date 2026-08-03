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
} from "../../db/questions";
import { isSafeUrl } from "../../lib/sanitizeHtml";

export const adminQuestions = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

const alternativeSchema = z.object({
  body: z.string().min(1),
  isCorrect: z.boolean(),
});

const questionSchema = z.object({
  type: z.enum(["multiple_choice", "true_false"]),
  statement: z.string().min(1),
  subjectId: z.string().min(1),
  bancaId: z.string().min(1),
  cargoId: z.string().nullish(),
  levelId: z.string().nullish(),
  year: z.number().int().min(1900).max(2200).nullish(),
  alternatives: z.array(alternativeSchema).min(1).max(10),
  explanation: z.object({
    body: z.string().min(1),
    // `.url()` sozinho aceita `javascript:`, `data:` e `vbscript:` (são URLs
    // válidas para o parser); `isSafeUrl` restringe a http, https e mailto.
    videoUrl: z
      .string()
      .url()
      .refine(isSafeUrl, { message: "esquema de URL não permitido" })
      .nullish(),
  }),
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

adminQuestions.get("/", async (c) => {
  const q = c.req.query();
  const year = q.year ? Number(q.year) : undefined;
  const result = await listQuestions(getDb(c.env), {
    subjectId: q.subjectId,
    bancaId: q.bancaId,
    cargoId: q.cargoId,
    levelId: q.levelId,
    year: Number.isFinite(year) ? year : undefined,
    status: q.status === "published" || q.status === "draft" ? q.status : undefined,
    limit: parseLimit(q.limit),
    offset: parseOffset(q.offset),
  });
  return c.json(result);
});

adminQuestions.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const res = await createQuestion(
    getDb(c.env),
    parsed.data as QuestionInput,
    c.get("entitlement")?.userId ?? null,
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
