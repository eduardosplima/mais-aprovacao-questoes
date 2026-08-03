import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env";
import type { Entitlement } from "../../db/users";
import { getDb } from "../../db/client";
import { isUniqueViolation } from "../../db/errors";
import {
  TERM_KINDS,
  createTerm,
  listTerms,
  renameTerm,
  softDeleteTerm,
  type TermKind,
} from "../../db/taxonomy";

export const adminTaxonomy = new Hono<{
  Bindings: Env;
  Variables: { entitlement: Entitlement };
}>();

const kindSchema = z.enum(TERM_KINDS as unknown as [TermKind, ...TermKind[]]);
const nameSchema = z.string().trim().min(1).max(120);

adminTaxonomy.get("/", async (c) => {
  const kind = kindSchema.safeParse(c.req.query("kind"));
  if (!kind.success) return c.json({ error: "invalid_kind" }, 400);
  return c.json({ terms: await listTerms(getDb(c.env), kind.data) });
});

const createSchema = z.object({ kind: kindSchema, name: nameSchema });

adminTaxonomy.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  try {
    const term = await createTerm(getDb(c.env), parsed.data.kind, parsed.data.name);
    return c.json({ term }, 201);
  } catch (e) {
    // Só a violação do índice parcial vira 409. Qualquer outra exceção sobe:
    // indisponibilidade de infra não pode chegar ao painel como "esse nome já
    // existe", que é um erro de validação e manda a pessoa tentar outro nome.
    if (isUniqueViolation(e)) return c.json({ error: "duplicate" }, 409);
    throw e;
  }
});

const renameSchema = z.object({ name: nameSchema });

adminTaxonomy.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  try {
    const term = await renameTerm(getDb(c.env), c.req.param("id"), parsed.data.name);
    if (!term) return c.json({ error: "not_found" }, 404);
    return c.json({ term });
  } catch (e) {
    // O rename recalcula o slug, então também esbarra no índice parcial.
    if (isUniqueViolation(e)) return c.json({ error: "duplicate" }, 409);
    throw e;
  }
});

adminTaxonomy.delete("/:id", async (c) => {
  const ok = await softDeleteTerm(getDb(c.env), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
