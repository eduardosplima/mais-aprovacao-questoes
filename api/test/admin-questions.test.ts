import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/config/env";
import type { Entitlement } from "../src/db/users";
import { getDb } from "../src/db/client";
import { createTerm } from "../src/db/taxonomy";
import { upsertUserFromPurchase } from "../src/db/users";
import { adminQuestions } from "../src/routes/admin/questions";

type App = { Bindings: Env; Variables: { entitlement: Entitlement } };

// `created_by` referencia users.id (Task 1), então o entitlement injetado
// precisa apontar para um usuário real — um id inventado quebra a FK.
let adminUserId: string | null = null;
async function ensureAdminUser(): Promise<string> {
  if (adminUserId) return adminUserId;
  adminUserId = await upsertUserFromPurchase(
    getDb(env),
    { email: "admin@test.com", name: null, documentHash: null },
    ["admin@test.com"],
  );
  return adminUserId;
}

function app() {
  const a = new Hono<App>();
  // A rota lê c.get("entitlement") para gravar created_by; injetamos um fixo.
  a.use("*", async (c, next) => {
    c.set("entitlement", {
      userId: await ensureAdminUser(),
      email: "admin@test.com",
      name: null,
      role: "admin",
      tier: "gratuito",
    });
    await next();
  });
  a.route("/admin/questions", adminQuestions);
  return a;
}

let seq = 0;
async function payload(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const db = getDb(env);
  const subject = await createTerm(db, "subject", `Rota assunto ${n}`);
  const banca = await createTerm(db, "banca", `Rota banca ${n}`);
  return {
    type: "multiple_choice",
    statement: "<p>Enunciado</p>",
    subjectId: subject.id,
    bancaId: banca.id,
    year: 2024,
    alternatives: [
      { body: "<p>A</p>", isCorrect: true },
      { body: "<p>B</p>", isCorrect: false },
    ],
    explanation: { body: "<p>Comentário</p>" },
    ...over,
  };
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function create(over: Record<string, unknown> = {}): Promise<string> {
  const res = await app().request("/admin/questions", post(await payload(over)), env);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("rotas de questões", () => {
  it("cria e devolve 201 com id", async () => {
    const res = await app().request("/admin/questions", post(await payload()), env);
    expect(res.status).toBe(201);
    expect((await res.json()) as { id: string }).toHaveProperty("id");
  });

  it("422 com o código do erro quando não há exatamente uma correta", async () => {
    const res = await app().request(
      "/admin/questions",
      post(
        await payload({
          alternatives: [
            { body: "<p>A</p>", isCorrect: true },
            { body: "<p>B</p>", isCorrect: true },
          ],
        }),
      ),
      env,
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toEqual({
      error: "exactly_one_correct",
    });
  });

  it("400 quando o corpo não é o esperado", async () => {
    const res = await app().request("/admin/questions", post({ type: "x" }), env);
    expect(res.status).toBe(400);
  });

  it("busca por id devolve alternativas e gabarito", async () => {
    const id = await create();
    const res = await app().request(`/admin/questions/${id}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      question: { alternatives: unknown[]; explanation: unknown };
    };
    expect(body.question.alternatives).toHaveLength(2);
    expect(body.question.explanation).toBeTruthy();
  });

  it("404 para id inexistente", async () => {
    const res = await app().request("/admin/questions/nao-existe", {}, env);
    expect(res.status).toBe(404);
  });

  it("publica e despublica", async () => {
    const id = await create();
    const pub = await app().request(
      `/admin/questions/${id}/publish`,
      { method: "POST" },
      env,
    );
    expect(pub.status).toBe(200);

    let res = await app().request(`/admin/questions/${id}`, {}, env);
    let body = (await res.json()) as { question: { status: string } };
    expect(body.question.status).toBe("published");

    await app().request(`/admin/questions/${id}/unpublish`, { method: "POST" }, env);
    res = await app().request(`/admin/questions/${id}`, {}, env);
    body = (await res.json()) as { question: { status: string } };
    expect(body.question.status).toBe("draft");
  });

  it("edita questão publicada mantendo o id", async () => {
    const id = await create();
    await app().request(`/admin/questions/${id}/publish`, { method: "POST" }, env);

    const res = await app().request(
      `/admin/questions/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await payload({ statement: "<p>Corrigido</p>" })),
      },
      env,
    );
    expect(res.status).toBe(200);

    const get = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await get.json()) as {
      question: { id: string; statement: string; status: string };
    };
    expect(body.question.id).toBe(id);
    expect(body.question.statement).toBe("<p>Corrigido</p>");
    expect(body.question.status).toBe("published");
  });

  it("apaga (soft) e some da listagem", async () => {
    const id = await create();
    const del = await app().request(`/admin/questions/${id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);

    const get = await app().request(`/admin/questions/${id}`, {}, env);
    expect(get.status).toBe(404);
  });

  it("lista com total e respeita o filtro de status", async () => {
    const id = await create();
    await app().request(`/admin/questions/${id}/publish`, { method: "POST" }, env);

    const res = await app().request("/admin/questions?status=published", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { id: string }[];
      total: number;
    };
    expect(body.rows.some((r) => r.id === id)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("sanitiza o enunciado que chega pela rota", async () => {
    const id = await create({ statement: '<p onclick="x()">E</p><script>y()</script>' });
    const res = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await res.json()) as { question: { statement: string } };
    expect(body.question.statement).toBe("<p>E</p>");
  });
});

// `limit`/`offset` vêm da querystring como string; valores negativos de
// `limit` viram "sem limite" no SQLite, então o parsing precisa validar
// antes de repassar para `listQuestions`.
describe("parsing de limit e offset em GET /admin/questions", () => {
  async function createInSubject(
    subjectId: string,
    bancaId: string,
    statement: string,
  ): Promise<string> {
    const res = await app().request(
      "/admin/questions",
      post({
        type: "multiple_choice",
        statement,
        subjectId,
        bancaId,
        year: 2024,
        alternatives: [
          { body: "<p>A</p>", isCorrect: true },
          { body: "<p>B</p>", isCorrect: false },
        ],
        explanation: { body: "<p>Comentário</p>" },
      }),
      env,
    );
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  it(
    "limit=-5 cai no default de 50 em vez de devolver a tabela inteira",
    async () => {
      const db = getDb(env);
      const subject = await createTerm(db, "subject", "Limit assunto bulk");
      const banca = await createTerm(db, "banca", "Limit banca bulk");
      for (let i = 0; i < 55; i++) {
        await createInSubject(subject.id, banca.id, `<p>Q${i}</p>`);
      }

      const res = await app().request(
        `/admin/questions?subjectId=${subject.id}&limit=-5`,
        {},
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: unknown[]; total: number };
      expect(body.total).toBe(55);
      expect(body.rows).toHaveLength(50);
    },
    20000,
  );

  it("limit=0 cai no default, não devolve lista vazia", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Limit assunto zero");
    const banca = await createTerm(db, "banca", "Limit banca zero");
    const id = await createInSubject(subject.id, banca.id, "<p>Q</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&limit=0`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string }[] };
    expect(body.rows.some((r) => r.id === id)).toBe(true);
  });

  it("limit=99999 é aceito sem estourar (teto aplicado antes da query)", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Limit assunto teto");
    const banca = await createTerm(db, "banca", "Limit banca teto");
    const id = await createInSubject(subject.id, banca.id, "<p>Q</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&limit=99999`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string }[] };
    expect(body.rows.some((r) => r.id === id)).toBe(true);
  });

  it("limit=abc (não numérico) cai no default", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Limit assunto abc");
    const banca = await createTerm(db, "banca", "Limit banca abc");
    const id = await createInSubject(subject.id, banca.id, "<p>Q</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&limit=abc`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string }[] };
    expect(body.rows.some((r) => r.id === id)).toBe(true);
  });

  it("offset=-5 cai no piso 0, não altera a paginação", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Offset assunto");
    const banca = await createTerm(db, "banca", "Offset banca");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");

    const withNegative = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=-5`,
      {},
      env,
    );
    const withZero = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=0`,
      {},
      env,
    );
    const bodyNeg = (await withNegative.json()) as { rows: { id: string }[] };
    const bodyZero = (await withZero.json()) as { rows: { id: string }[] };
    expect(bodyNeg.rows.map((r) => r.id)).toEqual(bodyZero.rows.map((r) => r.id));
    expect(bodyNeg.rows).toHaveLength(2);
  });
});
