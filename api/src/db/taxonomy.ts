import { and, eq, isNull, asc } from "drizzle-orm";
import type { Db } from "./client";
import { taxonomyTerms } from "./schema";

export type TermKind = "subject" | "banca" | "cargo" | "level";

export const TERM_KINDS: readonly TermKind[] = [
  "subject",
  "banca",
  "cargo",
  "level",
];

export type TermRow = typeof taxonomyTerms.$inferSelect;

/** Slug estável para o UNIQUE parcial: sem acento, sem caixa, sem espaço. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Único ponto onde o filtro de soft delete é escrito para taxonomia. */
const alive = isNull(taxonomyTerms.deletedAt);

export function listTerms(db: Db, kind: TermKind): Promise<TermRow[]> {
  return db
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.kind, kind), alive))
    .orderBy(asc(taxonomyTerms.name))
    .all();
}

export async function createTerm(
  db: Db,
  kind: TermKind,
  name: string,
): Promise<TermRow> {
  const row = {
    id: crypto.randomUUID(),
    kind,
    name: name.trim(),
    slug: slugify(name),
    createdAt: new Date(),
    deletedAt: null,
  };
  // Duplicata ativa viola o índice parcial e estoura aqui — é o comportamento
  // desejado, a rota traduz para 409.
  await db.insert(taxonomyTerms).values(row).run();
  return row;
}

/** Renomeia sem tocar no slug: ele é a identidade estável do termo. */
export async function renameTerm(
  db: Db,
  id: string,
  name: string,
): Promise<TermRow | null> {
  await db
    .update(taxonomyTerms)
    .set({ name: name.trim() })
    .where(and(eq(taxonomyTerms.id, id), alive))
    .run();
  const row = await db
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), alive))
    .get();
  return row ?? null;
}

export async function softDeleteTerm(db: Db, id: string): Promise<boolean> {
  const row = await db
    .select({ id: taxonomyTerms.id })
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), alive))
    .get();
  if (!row) return false;
  await db
    .update(taxonomyTerms)
    .set({ deletedAt: new Date() })
    .where(eq(taxonomyTerms.id, id))
    .run();
  return true;
}

/**
 * A invariante que o banco não consegue impor. Uma tabela só para as quatro
 * taxonomias economiza muito código, mas nada em SQLite impede `banca_id`
 * apontar para um termo de `kind='cargo'` — CHECK não aceita subquery. Toda
 * escrita de questão passa por aqui.
 */
export async function assertKind(
  db: Db,
  id: string,
  kind: TermKind,
): Promise<boolean> {
  const row = await db
    .select({ kind: taxonomyTerms.kind })
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), alive))
    .get();
  return row?.kind === kind;
}
