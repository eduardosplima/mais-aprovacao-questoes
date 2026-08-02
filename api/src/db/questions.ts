import { and, eq, isNull, desc, count, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { questions, alternatives, explanations, taxonomyTerms } from "./schema";
import { assertKind } from "./taxonomy";
import { sanitizeHtml } from "../lib/sanitizeHtml";

export type QuestionType = "multiple_choice" | "true_false";
export type QuestionStatus = "draft" | "published";

export interface AlternativeInput {
  body: string;
  isCorrect: boolean;
}

export interface QuestionInput {
  type: QuestionType;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId?: string | null;
  levelId?: string | null;
  year?: number | null;
  alternatives: AlternativeInput[];
  explanation: { body: string; videoUrl?: string | null };
}

export interface QuestionDetail {
  id: string;
  type: QuestionType;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId: string | null;
  levelId: string | null;
  year: number | null;
  status: QuestionStatus;
  alternatives: { id: string; position: number; body: string; isCorrect: boolean }[];
  explanation: { body: string; videoUrl: string | null } | null;
}

export interface QuestionListRow {
  id: string;
  statement: string;
  type: QuestionType;
  status: QuestionStatus;
  year: number | null;
  subjectName: string | null;
  bancaName: string | null;
}

/** Único ponto onde o filtro de soft delete é escrito para questões. */
const alive = isNull(questions.deletedAt);

type Failure = { error: string };

/**
 * Valida o que o banco não consegue. Três famílias:
 * - contagem e unicidade da alternativa correta;
 * - `true_false` com exatamente duas;
 * - cada FK de taxonomia apontando para o `kind` certo (o preço da tabela única).
 */
async function validate(db: Db, input: QuestionInput): Promise<string | null> {
  if (input.type === "true_false") {
    if (input.alternatives.length !== 2) return "true_false_needs_two";
  } else if (input.alternatives.length < 2) {
    return "needs_two_alternatives";
  }

  if (input.alternatives.filter((a) => a.isCorrect).length !== 1) {
    return "exactly_one_correct";
  }

  if (!(await assertKind(db, input.subjectId, "subject"))) return "invalid_subject";
  if (!(await assertKind(db, input.bancaId, "banca"))) return "invalid_banca";
  if (input.cargoId && !(await assertKind(db, input.cargoId, "cargo"))) {
    return "invalid_cargo";
  }
  if (input.levelId && !(await assertKind(db, input.levelId, "level"))) {
    return "invalid_level";
  }
  return null;
}

/** Grava alternativas e gabarito já sanitizados. Substitui o que existir. */
async function writeChildren(
  db: Db,
  questionId: string,
  input: QuestionInput,
): Promise<void> {
  await db.delete(alternatives).where(eq(alternatives.questionId, questionId)).run();

  for (const [position, alt] of input.alternatives.entries()) {
    await db
      .insert(alternatives)
      .values({
        id: crypto.randomUUID(),
        questionId,
        position,
        body: await sanitizeHtml(alt.body),
        isCorrect: alt.isCorrect ? 1 : 0,
      })
      .run();
  }

  const body = await sanitizeHtml(input.explanation.body);
  await db
    .insert(explanations)
    .values({
      questionId,
      body,
      videoUrl: input.explanation.videoUrl ?? null,
    })
    .onConflictDoUpdate({
      target: explanations.questionId,
      set: { body, videoUrl: input.explanation.videoUrl ?? null },
    })
    .run();
}

export async function createQuestion(
  db: Db,
  input: QuestionInput,
  createdBy: string | null,
): Promise<{ id: string } | Failure> {
  const problem = await validate(db, input);
  if (problem) return { error: problem };

  const id = crypto.randomUUID();
  const now = new Date();
  await db
    .insert(questions)
    .values({
      id,
      type: input.type,
      statement: await sanitizeHtml(input.statement),
      subjectId: input.subjectId,
      bancaId: input.bancaId,
      cargoId: input.cargoId ?? null,
      levelId: input.levelId ?? null,
      year: input.year ?? null,
      status: "draft",
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await writeChildren(db, id, input);
  return { id };
}

/**
 * Edição é livre, publicada ou não, e o id nunca muda — é o que mantém as
 * attempts, comentários e anotações do sub-projeto 3 apontando para a mesma
 * questão depois de uma correção de gabarito.
 */
export async function updateQuestion(
  db: Db,
  id: string,
  input: QuestionInput,
): Promise<{ ok: true } | Failure> {
  const existing = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, id), alive))
    .get();
  if (!existing) return { error: "not_found" };

  const problem = await validate(db, input);
  if (problem) return { error: problem };

  await db
    .update(questions)
    .set({
      type: input.type,
      statement: await sanitizeHtml(input.statement),
      subjectId: input.subjectId,
      bancaId: input.bancaId,
      cargoId: input.cargoId ?? null,
      levelId: input.levelId ?? null,
      year: input.year ?? null,
      updatedAt: new Date(),
    })
    .where(eq(questions.id, id))
    .run();

  await writeChildren(db, id, input);
  return { ok: true };
}

export async function getQuestion(
  db: Db,
  id: string,
): Promise<QuestionDetail | null> {
  const row = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), alive))
    .get();
  if (!row) return null;

  const alts = await db
    .select()
    .from(alternatives)
    .where(eq(alternatives.questionId, id))
    .all();
  const exp = await db
    .select()
    .from(explanations)
    .where(eq(explanations.questionId, id))
    .get();

  return {
    id: row.id,
    type: row.type as QuestionType,
    statement: row.statement,
    subjectId: row.subjectId,
    bancaId: row.bancaId,
    cargoId: row.cargoId,
    levelId: row.levelId,
    year: row.year,
    status: row.status as QuestionStatus,
    alternatives: alts
      .sort((a, b) => a.position - b.position)
      .map((a) => ({
        id: a.id,
        position: a.position,
        body: a.body,
        isCorrect: a.isCorrect === 1,
      })),
    explanation: exp ? { body: exp.body, videoUrl: exp.videoUrl } : null,
  };
}

export interface QuestionFilters {
  subjectId?: string;
  bancaId?: string;
  cargoId?: string;
  levelId?: string;
  year?: number;
  status?: QuestionStatus;
  limit?: number;
  offset?: number;
}

export async function listQuestions(
  db: Db,
  filters: QuestionFilters,
): Promise<{ rows: QuestionListRow[]; total: number }> {
  const where: SQL[] = [alive];
  if (filters.subjectId) where.push(eq(questions.subjectId, filters.subjectId));
  if (filters.bancaId) where.push(eq(questions.bancaId, filters.bancaId));
  if (filters.cargoId) where.push(eq(questions.cargoId, filters.cargoId));
  if (filters.levelId) where.push(eq(questions.levelId, filters.levelId));
  if (filters.year) where.push(eq(questions.year, filters.year));
  if (filters.status) where.push(eq(questions.status, filters.status));
  const predicate = and(...where);

  const total = await db
    .select({ n: count() })
    .from(questions)
    .where(predicate)
    .get();

  // Nomes das taxonomias resolvidos em memória: são poucas dezenas de termos e
  // dois JOINs à mesma tabela pediriam alias, que o Drizzle/D1 complica sem
  // ganho real neste volume.
  const rows = await db
    .select()
    .from(questions)
    .where(predicate)
    .orderBy(desc(questions.updatedAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0)
    .all();

  const terms = await db.select().from(taxonomyTerms).all();
  const nameOf = new Map(terms.map((t) => [t.id, t.name]));

  return {
    total: total?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      statement: r.statement,
      type: r.type as QuestionType,
      status: r.status as QuestionStatus,
      year: r.year,
      subjectName: nameOf.get(r.subjectId) ?? null,
      bancaName: nameOf.get(r.bancaId) ?? null,
    })),
  };
}

export async function setStatus(
  db: Db,
  id: string,
  status: QuestionStatus,
): Promise<boolean> {
  const row = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, id), alive))
    .get();
  if (!row) return false;
  await db
    .update(questions)
    .set({ status, updatedAt: new Date() })
    .where(eq(questions.id, id))
    .run();
  return true;
}

export async function softDeleteQuestion(db: Db, id: string): Promise<boolean> {
  const row = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, id), alive))
    .get();
  if (!row) return false;
  await db
    .update(questions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(questions.id, id))
    .run();
  return true;
}
