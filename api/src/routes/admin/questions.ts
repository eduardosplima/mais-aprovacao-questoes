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
    videoUrl: z.string().url().nullish(),
  }),
});

/**
 * `not_found` é 404; todo o resto é falha de regra de negócio (invariante de
 * alternativa correta, `kind` cruzado de taxonomia) e vira 422 com o código,
 * para o painel poder exibir a mensagem específica.
 */
const statusFor = (error: string): 404 | 422 =>
  error === "not_found" ? 404 : 422;

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
    limit: q.limit ? Math.min(Number(q.limit) || 50, 200) : 50,
    offset: q.offset ? Number(q.offset) || 0 : 0,
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
