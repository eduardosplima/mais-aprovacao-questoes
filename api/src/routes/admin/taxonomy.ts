import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config/env";
import { getDb } from "../../db/client";
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
  Variables: { accessEmail: string };
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

  const result = await createTerm(getDb(c.env), parsed.data.kind, parsed.data.name);
  if ("error" in result) return c.json(result, 409);
  return c.json({ term: result }, 201);
});

const renameSchema = z.object({ name: nameSchema });

adminTaxonomy.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const result = await renameTerm(getDb(c.env), c.req.param("id"), parsed.data.name);
  if (result === null) return c.json({ error: "not_found" }, 404);
  if ("error" in result) return c.json(result, 409);
  return c.json({ term: result });
});

adminTaxonomy.delete("/:id", async (c) => {
  const ok = await softDeleteTerm(getDb(c.env), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
