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
