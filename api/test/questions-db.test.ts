import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { getDb } from "../src/db/client";
import { createTerm as createTermRaw, softDeleteTerm } from "../src/db/taxonomy";
import {
  createQuestion,
  updateQuestion,
  getQuestion,
  listQuestions,
  setStatus,
  softDeleteQuestion,
  type QuestionInput,
} from "../src/db/questions";

const db = () => getDb(env);
let seq = 0;

// Fixture: os nomes usados neste arquivo são únicos por chamada (via `seq`),
// então nunca colidem de verdade — `createTerm` devolvendo `Failure` numa
// duplicata é comportamento de outro módulo (testado em taxonomy.test.ts).
async function createTerm(...args: Parameters<typeof createTermRaw>) {
  const row = await createTermRaw(...args);
  if ("error" in row) throw new Error(`termo duplicado inesperado no fixture: ${args[2]}`);
  return row;
}

async function baseInput(
  over: Partial<QuestionInput> = {},
): Promise<QuestionInput> {
  const n = ++seq;
  const subject = await createTerm(db(), "subject", `Assunto ${n}`);
  const banca = await createTerm(db(), "banca", `Banca ${n}`);
  return {
    type: "multiple_choice",
    statement: "<p>Enunciado</p>",
    subjectId: subject.id,
    bancaId: banca.id,
    year: 2023,
    alternatives: [
      { body: "<p>A</p>", isCorrect: true },
      { body: "<p>B</p>", isCorrect: false },
    ],
    explanation: { body: "<p>Porque sim</p>" },
    ...over,
  };
}

describe("questions", () => {
  it("cria com alternativas e gabarito", async () => {
    const res = await createQuestion(db(), await baseInput(), null);
    expect("id" in res).toBe(true);
    const detail = await getQuestion(db(), (res as { id: string }).id);
    expect(detail?.alternatives).toHaveLength(2);
    expect(detail?.explanation?.body).toBe("<p>Porque sim</p>");
  });

  it("sanitiza o enunciado na escrita", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({ statement: '<p onclick="x()">E</p><script>y()</script>' }),
      null,
    );
    const detail = await getQuestion(db(), (res as { id: string }).id);
    expect(detail?.statement).toBe("<p>E</p>");
  });

  it("recusa questão sem alternativa correta", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({
        alternatives: [
          { body: "<p>A</p>", isCorrect: false },
          { body: "<p>B</p>", isCorrect: false },
        ],
      }),
      null,
    );
    expect(res).toEqual({ error: "exactly_one_correct" });
  });

  it("recusa questão com duas alternativas corretas", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({
        alternatives: [
          { body: "<p>A</p>", isCorrect: true },
          { body: "<p>B</p>", isCorrect: true },
        ],
      }),
      null,
    );
    expect(res).toEqual({ error: "exactly_one_correct" });
  });

  it("recusa true_false que não tenha exatamente 2 alternativas", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({
        type: "true_false",
        alternatives: [
          { body: "Certo", isCorrect: true },
          { body: "Errado", isCorrect: false },
          { body: "Talvez", isCorrect: false },
        ],
      }),
      null,
    );
    expect(res).toEqual({ error: "true_false_needs_two" });
  });

  it("aceita true_false com duas alternativas", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({
        type: "true_false",
        alternatives: [
          { body: "Certo", isCorrect: true },
          { body: "Errado", isCorrect: false },
        ],
      }),
      null,
    );
    expect("id" in res).toBe(true);
  });

  it("recusa multiple_choice com menos de 2 alternativas", async () => {
    const res = await createQuestion(
      db(),
      await baseInput({ alternatives: [{ body: "<p>A</p>", isCorrect: true }] }),
      null,
    );
    expect(res).toEqual({ error: "needs_two_alternatives" });
  });

  // A invariante que paga o preço da tabela única de taxonomias.
  it("recusa banca_id apontando para um termo de kind cargo", async () => {
    const cargo = await createTerm(db(), "cargo", `Cargo cruzado ${++seq}`);
    const res = await createQuestion(
      db(),
      await baseInput({ bancaId: cargo.id }),
      null,
    );
    expect(res).toEqual({ error: "invalid_banca" });
  });

  it("recusa subject_id apontando para um termo de kind banca", async () => {
    const banca = await createTerm(db(), "banca", `Banca cruzada ${++seq}`);
    const res = await createQuestion(
      db(),
      await baseInput({ subjectId: banca.id }),
      null,
    );
    expect(res).toEqual({ error: "invalid_subject" });
  });

  it("edita questão publicada preservando o id", async () => {
    const res = await createQuestion(db(), await baseInput(), null);
    const id = (res as { id: string }).id;
    await setStatus(db(), id, "published");
    const upd = await updateQuestion(db(), id, {
      ...(await baseInput()),
      statement: "<p>Corrigido</p>",
    });
    expect(upd).toEqual({ ok: true });
    const detail = await getQuestion(db(), id);
    expect(detail?.id).toBe(id);
    expect(detail?.statement).toBe("<p>Corrigido</p>");
    expect(detail?.status).toBe("published");
  });

  it("a edição substitui as alternativas sem duplicar", async () => {
    const res = await createQuestion(db(), await baseInput(), null);
    const id = (res as { id: string }).id;
    await updateQuestion(db(), id, {
      ...(await baseInput()),
      alternatives: [
        { body: "<p>X</p>", isCorrect: false },
        { body: "<p>Y</p>", isCorrect: true },
        { body: "<p>Z</p>", isCorrect: false },
      ],
    });
    const detail = await getQuestion(db(), id);
    expect(detail?.alternatives).toHaveLength(3);
    expect(detail?.alternatives[1].isCorrect).toBe(true);
  });

  // Prova da correção de atomicidade: a troca de alternativas+gabarito é um
  // único db.batch(). Mockar essa chamada para falhar simula uma falha no
  // meio do delete+inserts sem depender de violar uma constraint de verdade
  // (os ids são gerados internamente, fora do alcance do teste). Se o delete
  // e os inserts ainda fossem chamadas .run() separadas, este mock não
  // provaria nada — o delete já teria sido aplicado antes da falha simulada.
  it("falha na escrita das alternativas não deixa a questão sem elas (batch atômico)", async () => {
    const created = await createQuestion(db(), await baseInput(), null);
    const id = (created as { id: string }).id;
    const before = await getQuestion(db(), id);
    expect(before?.alternatives).toHaveLength(2);

    const database = db();
    const batchSpy = vi
      .spyOn(database, "batch")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(
      updateQuestion(database, id, {
        ...(await baseInput()),
        alternatives: [
          { body: "<p>X</p>", isCorrect: false },
          { body: "<p>Y</p>", isCorrect: true },
        ],
      }),
    ).rejects.toThrow("boom");

    batchSpy.mockRestore();

    const after = await getQuestion(db(), id);
    expect(after?.alternatives).toHaveLength(2);
    expect(after?.alternatives.map((a) => a.body)).toEqual(
      before?.alternatives.map((a) => a.body),
    );
    expect(after?.explanation?.body).toBe(before?.explanation?.body);
  });

  it("questão soft-deletada some da listagem e do get", async () => {
    const res = await createQuestion(db(), await baseInput(), null);
    const id = (res as { id: string }).id;
    expect(await softDeleteQuestion(db(), id)).toBe(true);
    expect(await getQuestion(db(), id)).toBeNull();
    const { rows } = await listQuestions(db(), {});
    expect(rows.some((r) => r.id === id)).toBe(false);
  });

  // Apagar (soft) uma taxonomia em uso não pode tornar as questões que a
  // referenciam permanentemente ineditáveis — só a FK que MUDA é revalidada.
  it("PATCH mantendo um bancaId soft-deletado funciona (FK que não mudou)", async () => {
    const input = await baseInput();
    const res = await createQuestion(db(), input, null);
    const id = (res as { id: string }).id;

    expect(await softDeleteTerm(db(), input.bancaId)).toBe(true);

    const upd = await updateQuestion(db(), id, {
      ...input,
      statement: "<p>Corrigido</p>",
    });
    expect(upd).toEqual({ ok: true });
  });

  it("PATCH trocando para um bancaId soft-deletado é recusado com invalid_banca", async () => {
    const input = await baseInput();
    const res = await createQuestion(db(), input, null);
    const id = (res as { id: string }).id;

    const outraBanca = await createTerm(db(), "banca", `Banca morta ${++seq}`);
    expect(await softDeleteTerm(db(), outraBanca.id)).toBe(true);

    const upd = await updateQuestion(db(), id, {
      ...input,
      bancaId: outraBanca.id,
    });
    expect(upd).toEqual({ error: "invalid_banca" });
  });

  it("PATCH trocando para termo de kind errado continua recusado", async () => {
    const input = await baseInput();
    const res = await createQuestion(db(), input, null);
    const id = (res as { id: string }).id;

    const cargo = await createTerm(db(), "cargo", `Cargo cruzado ${++seq}`);

    const upd = await updateQuestion(db(), id, {
      ...input,
      bancaId: cargo.id,
    });
    expect(upd).toEqual({ error: "invalid_banca" });
  });

  it("filtra por status e por banca", async () => {
    const input = await baseInput();
    const res = await createQuestion(db(), input, null);
    const id = (res as { id: string }).id;
    await setStatus(db(), id, "published");

    const porBanca = await listQuestions(db(), { bancaId: input.bancaId });
    expect(porBanca.rows.some((r) => r.id === id)).toBe(true);

    const rascunhos = await listQuestions(db(), { status: "draft" });
    expect(rascunhos.rows.some((r) => r.id === id)).toBe(false);
  });
});
