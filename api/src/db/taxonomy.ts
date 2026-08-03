import { and, eq, isNull, asc } from "drizzle-orm";
import type { Db } from "./client";
import { taxonomyTerms } from "./schema";
import { isUniqueViolation } from "./errors";
import type { Failure } from "./questions";

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
    // Faixa dos diacríticos combinantes que o NFD separou da letra base.
    // Escrita escapada porque a forma literal são caracteres invisíveis, que
    // ninguém consegue conferir numa revisão.
    .replace(/[\u0300-\u036f]/g, "")
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
): Promise<TermRow | Failure> {
  const row = {
    id: crypto.randomUUID(),
    kind,
    name: name.trim(),
    slug: slugify(name),
    createdAt: new Date(),
    deletedAt: null,
  };
  try {
    // Duplicata ativa viola o índice parcial — é o comportamento desejado,
    // capturado aqui e devolvido como `Failure` para a rota traduzir a 409.
    await db.insert(taxonomyTerms).values(row).run();
  } catch (e) {
    // Só a violação do índice parcial vira `duplicate`. Qualquer outra
    // exceção sobe: indisponibilidade de infra não pode chegar ao painel
    // como "esse nome já existe", que é um erro de validação e manda a
    // pessoa tentar outro nome.
    if (isUniqueViolation(e)) return { error: "duplicate" };
    throw e;
  }
  return row;
}

/**
 * Renomeia recalculando o slug, que é o que faz o índice parcial recusar dois
 * termos ativos com o mesmo nome também no rename — a mesma regra da criação,
 * escrita num lugar só. A violação vira `Failure`; a rota traduz para 409.
 *
 * O slug não tem consumidor fora do índice: nenhuma FK aponta para ele (as
 * questões referenciam `id`) e nenhuma rota o recebe como filtro. Congelá-lo
 * custaria uma segunda regra de unicidade em código de aplicação, que ainda
 * divergiria da primeira — renomear "Cespe" para outra coisa deixaria o slug
 * em `cespe`, reservando o nome antigo para uma linha que não o usa mais.
 */
export async function renameTerm(
  db: Db,
  id: string,
  name: string,
): Promise<TermRow | Failure | null> {
  try {
    // O rename recalcula o slug, então também esbarra no índice parcial.
    await db
      .update(taxonomyTerms)
      .set({ name: name.trim(), slug: slugify(name) })
      .where(and(eq(taxonomyTerms.id, id), alive))
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "duplicate" };
    throw e;
  }
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
