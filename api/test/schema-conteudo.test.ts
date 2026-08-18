import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import {
  taxonomyTerms,
  questions,
  alternatives,
  explanations,
} from "../src/db/schema";

const db = () => getDb(env);

async function term(kind: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await db()
    .insert(taxonomyTerms)
    .values({ id, kind, name: slug, slug, createdAt: new Date() })
    .run();
  return id;
}

async function question(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db()
    .insert(questions)
    .values({
      id,
      type: "multiple_choice",
      statement: "<p>enunciado</p>",
      subjectId: await term("subject", "dir-adm-" + id),
      bancaId: await term("banca", "cespe-" + id),
      year: 2023,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe("schema de conteúdo", () => {
  it("apagar a questão leva alternativas e gabarito junto (CASCADE)", async () => {
    const qid = await question();
    await db()
      .insert(alternatives)
      .values({
        id: crypto.randomUUID(),
        questionId: qid,
        position: 0,
        body: "<p>A</p>",
        isCorrect: 1,
      })
      .run();
    await db()
      .insert(explanations)
      .values({ questionId: qid, body: "<p>porque sim</p>" })
      .run();

    await db().delete(questions).where(eq(questions.id, qid)).run();

    const alts = await db()
      .select()
      .from(alternatives)
      .where(eq(alternatives.questionId, qid))
      .all();
    const exps = await db()
      .select()
      .from(explanations)
      .where(eq(explanations.questionId, qid))
      .all();
    expect(alts).toHaveLength(0);
    expect(exps).toHaveLength(0);
  });

  it("questão sem ano é recusada pelo banco", async () => {
    const subject = await term("subject", "sem-ano-" + crypto.randomUUID());
    const banca = await term("banca", "sem-ano-" + crypto.randomUUID());
    const agora = Date.now();

    // SQL cru de propósito: o tipo do drizzle já proíbe omitir o ano depois
    // que a coluna virou notNull, então um insert pelo ORM provaria só o
    // TypeScript. O que interessa aqui é a outra camada — que o banco
    // recusa sozinho, mesmo que alguém escreva direto nele um dia.
    await expect(
      env.DB.prepare(
        "INSERT INTO questions (id, type, statement, subject_id, banca_id, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          "multiple_choice",
          "<p>enunciado</p>",
          subject,
          banca,
          "draft",
          agora,
          agora,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("o índice parcial permite recriar um slug soft-deletado", async () => {
    const id = await term("banca", "fgv");
    await db()
      .update(taxonomyTerms)
      .set({ deletedAt: new Date() })
      .where(eq(taxonomyTerms.id, id))
      .run();

    // sem o `WHERE deleted_at IS NULL` no índice, isto violaria o UNIQUE
    await expect(term("banca", "fgv")).resolves.toBeTruthy();
  });

  it("dois termos ativos com o mesmo kind e slug são recusados", async () => {
    await term("cargo", "analista");
    await expect(term("cargo", "analista")).rejects.toThrow();
  });
});
