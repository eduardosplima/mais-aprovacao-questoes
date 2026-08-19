import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../src/config/env";
import type { Entitlement } from "../src/db/users";
import { getDb } from "../src/db/client";
import { questions } from "../src/db/schema";
import { createTerm as createTermRaw } from "../src/db/taxonomy";
import { upsertUserFromPurchase } from "../src/db/users";
import { deleteAdmin, upsertAdmin } from "../src/db/admins";
import { adminQuestions } from "../src/routes/admin/questions";

type App = {
  Bindings: Env;
  Variables: { entitlement: Entitlement; accessEmail: string };
};

// Fixture: os nomes usados neste arquivo são únicos por chamada, então nunca
// colidem de verdade — `createTerm` devolvendo `Failure` numa duplicata é
// comportamento de outro módulo (testado em taxonomy.test.ts), não algo que
// os testes de rota de questão precisem lidar por linha.
async function createTerm(...args: Parameters<typeof createTermRaw>) {
  const row = await createTermRaw(...args);
  if ("error" in row) throw new Error(`termo duplicado inesperado no fixture: ${args[2]}`);
  return row;
}

// `created_by` referencia users.id (Task 1), então o entitlement injetado
// precisa apontar para um usuário real — um id inventado quebra a FK.
let adminUserId: string | null = null;
async function ensureAdminUser(): Promise<string> {
  if (adminUserId) return adminUserId;
  adminUserId = await upsertUserFromPurchase(getDb(env), {
    email: "admin@test.com",
    name: null,
    documentHash: null,
  });
  return adminUserId;
}

function app() {
  const a = new Hono<App>();
  // A rota grava emailDoAccess(c) em created_by (Task 11), que referencia
  // admins.email — a linha precisa existir para a FK, e o email precisa
  // estar no contexto como requireAccess faria em produção.
  a.use("*", async (c, next) => {
    await upsertAdmin(getDb(env), "admin@test.com", "hash-nao-usado-neste-teste");
    c.set("accessEmail", "admin@test.com");
    c.set("entitlement", {
      userId: await ensureAdminUser(),
      email: "admin@test.com",
      name: null,
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

  it("grava o email do Access em created_by", async () => {
    const res = await app().request("/admin/questions", post(await payload()), env);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const linha = await getDb(env)
      .select({ createdBy: questions.createdBy })
      .from(questions)
      .where(eq(questions.id, id))
      .get();
    expect(linha?.createdBy).toBe("admin@test.com");
  });

  it("apagar o admin deixa a questão sem autoria, não apaga a questão", async () => {
    const res = await app().request("/admin/questions", post(await payload()), env);
    const { id } = (await res.json()) as { id: string };

    await deleteAdmin(getDb(env), "admin@test.com");

    const linha = await getDb(env)
      .select({ createdBy: questions.createdBy })
      .from(questions)
      .where(eq(questions.id, id))
      .get();
    expect(linha).toBeDefined();
    expect(linha?.createdBy).toBeNull();
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

  it("400 ao criar questão sem year — o ano é obrigatório", async () => {
    const { year: _ignorado, ...semAno } = await payload();

    const res = await app().request("/admin/questions", post(semAno), env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("201 ao criar questão sem explanation — o gabarito é opcional", async () => {
    const { explanation: _ignorado, ...semGabarito } = await payload();

    const res = await app().request("/admin/questions", post(semGabarito), env);
    expect(res.status).toBe(201);

    const { id } = (await res.json()) as { id: string };
    const busca = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await busca.json()) as { question: { explanation: unknown } };
    expect(body.question.explanation).toBeFalsy();
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

  // `videoUrl` é gravado cru em writeChildren, sem sanitização de HTML — a
  // única barreira é a validação de schema aqui. `mailto:` não era brecha de
  // segurança, e sim de significado: um campo de vídeo aceitando endereço de
  // email, herdado de `isSafeUrl`, que existe para `href` de conteúdo.
  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "mailto:a@test.com",
    "/videos/aula.mp4",
    "#ancora",
  ])("recusa videoUrl que não seja http/https (%s)", async (videoUrl) => {
    const res = await app().request(
      "/admin/questions",
      post(await payload({ explanation: { body: "<p>C</p>", videoUrl } })),
      env,
    );
    expect(res.status).toBe(400);
  });

  it.each([
    "https://youtu.be/x",
    "https://customer-abc123.cloudflarestream.com/deadbeef/watch",
    "http://localhost:8787/video",
  ])("aceita videoUrl http/https (%s)", async (videoUrl) => {
    const res = await app().request(
      "/admin/questions",
      post(await payload({ explanation: { body: "<p>C</p>", videoUrl } })),
      env,
    );
    expect(res.status).toBe(201);
  });

  it("POST com status=published já cria publicada, num round-trip só", async () => {
    const res = await app().request(
      "/admin/questions",
      post(await payload({ status: "published" })),
      env,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const get = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await get.json()) as { question: { status: string } };
    expect(body.question.status).toBe("published");
  });

  it("POST sem status continua criando rascunho", async () => {
    const id = await create();
    const res = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await res.json()) as { question: { status: string } };
    expect(body.question.status).toBe("draft");
  });

  it("400 para status desconhecido no POST", async () => {
    const res = await app().request(
      "/admin/questions",
      post(await payload({ status: "publicado" })),
      env,
    );
    expect(res.status).toBe(400);
  });

  // A armadilha que motivou schemas separados: PATCH e POST compartilhavam o
  // mesmo objeto Zod, e um `status` com default nele faria toda edição gravar
  // "draft" — despublicando em silêncio a questão que alguém só quis corrigir.
  it("status no corpo do PATCH é ignorado e não despublica a questão", async () => {
    const id = await create();
    await app().request(`/admin/questions/${id}/publish`, { method: "POST" }, env);

    const res = await app().request(
      `/admin/questions/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await payload({ status: "draft" })),
      },
      env,
    );
    expect(res.status).toBe(200);

    const get = await app().request(`/admin/questions/${id}`, {}, env);
    const body = (await get.json()) as { question: { status: string } };
    expect(body.question.status).toBe("published");
  });

  // Filtro descartado em silêncio faz a tela mostrar o acervo inteiro — com
  // rascunhos — dizendo que está filtrada. Por isso 400 e não default.
  it("400 com o código do campo para status de filtro desconhecido", async () => {
    const res = await app().request("/admin/questions?status=publicado", {}, env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_status",
    });
  });

  it("400 com o código do campo para year não numérico", async () => {
    const res = await app().request("/admin/questions?year=ontem", {}, env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_year",
    });
  });

  it("400 para year fora do intervalo aceito", async () => {
    const res = await app().request("/admin/questions?year=1500", {}, env);
    expect(res.status).toBe(400);
  });

  it("filtro válido de year continua filtrando", async () => {
    const body = await payload();
    await app().request("/admin/questions", post(body), env);

    const res = await app().request(
      `/admin/questions?subjectId=${body.subjectId}&year=2024`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });

  // Id opaco de filtro passa cru: "malformado" e "não existe" são
  // indistinguíveis, e lista vazia é a resposta honesta para os dois.
  it("subjectId inexistente devolve lista vazia, não 400", async () => {
    const res = await app().request("/admin/questions?subjectId=nao-existe", {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });

  // Ruling: valor vazio de filtro é "sem filtro" em todo campo, não um valor
  // a ser validado — é o que o <select><option value=""> do painel manda
  // quando o operador limpa o filtro.
  describe("valor vazio de filtro é tratado como ausente", () => {
    it("status= vazio não filtra (traz rascunho e publicada)", async () => {
      const draftId = await create();
      const publishedId = await create();
      await app().request(`/admin/questions/${publishedId}/publish`, { method: "POST" }, env);

      const res = await app().request("/admin/questions?status=", {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: { id: string }[] };
      const ids = body.rows.map((r) => r.id);
      expect(ids).toContain(draftId);
      expect(ids).toContain(publishedId);
    });

    it("year= vazio não filtra por ano", async () => {
      const base = await payload({ year: 2020 });
      await app().request("/admin/questions", post(base), env);
      await app().request("/admin/questions", post({ ...base, year: 1999 }), env);

      const res = await app().request(
        `/admin/questions?subjectId=${base.subjectId}&year=`,
        {},
        env,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { total: number }).total).toBe(2);
    });

    it("year=%20 (só espaço) não filtra por ano", async () => {
      const base = await payload({ year: 2020 });
      await app().request("/admin/questions", post(base), env);
      await app().request("/admin/questions", post({ ...base, year: 1999 }), env);

      const res = await app().request(
        `/admin/questions?subjectId=${base.subjectId}&year=%20`,
        {},
        env,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { total: number }).total).toBe(2);
    });

    it("subjectId= vazio não filtra por assunto", async () => {
      const id = await create();
      const res = await app().request("/admin/questions?subjectId=", {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: { id: string }[] };
      expect(body.rows.some((r) => r.id === id)).toBe(true);
    });
  });

  it.each([
    ["corpo que não é JSON", "isso nao e json"],
    ["JSON truncado", '{"type":"multiple_choice",'],
    ["corpo vazio", ""],
    ["JSON que não é objeto", "[]"],
  ])("400 para %s no POST", async (_label, body) => {
    const res = await app().request(
      "/admin/questions",
      { method: "POST", headers: { "content-type": "application/json" }, body },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 para corpo malformado no PATCH", async () => {
    const id = await create();
    const res = await app().request(
      `/admin/questions/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{{{",
      },
      env,
    );
    expect(res.status).toBe(400);
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

  // A outra metade da convenção: paginação inválida NÃO vira 400. Clampar o
  // limit não mente sobre o conteúdo, então segue caindo no default.
  //
  // Acima do teto de 200, o valor não é clampado: cai no default de 50, o
  // mesmo destino de qualquer outro limit fora de [1, 200].
  it(
    "limit=99999 (acima do teto) cai no default de 50, não devolve a tabela inteira",
    async () => {
      const db = getDb(env);
      const subject = await createTerm(db, "subject", "Limit assunto acima teto");
      const banca = await createTerm(db, "banca", "Limit banca acima teto");
      for (let i = 0; i < 55; i++) {
        await createInSubject(subject.id, banca.id, `<p>Q${i}</p>`);
      }

      const res = await app().request(
        `/admin/questions?subjectId=${subject.id}&limit=99999`,
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

  // Valor fracionário (ex.: 1.5) não é NaN nem < 1, então sobrevivia ao
  // parsing e chegava ao D1 como bind não-inteiro, causando
  // SQLITE_MISMATCH (500). Precisa cair no default como qualquer outra
  // entrada inválida.
  it("limit=1.5 (fracionário) cai no default, sem truncar nem devolver 500", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Limit assunto fracionario");
    const banca = await createTerm(db, "banca", "Limit banca fracionario");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");
    await createInSubject(subject.id, banca.id, "<p>Q3</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&limit=1.5`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; total: number };
    expect(body.total).toBe(3);
    expect(body.rows).toHaveLength(3);
  });

  it("offset=1.5 (fracionário) cai no piso 0, sem devolver 500", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Offset assunto fracionario");
    const banca = await createTerm(db, "banca", "Offset banca fracionario");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");

    const withFraction = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=1.5`,
      {},
      env,
    );
    const withZero = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=0`,
      {},
      env,
    );
    expect(withFraction.status).toBe(200);
    const bodyFraction = (await withFraction.json()) as { rows: { id: string }[] };
    const bodyZero = (await withZero.json()) as { rows: { id: string }[] };
    expect(bodyFraction.rows.map((r) => r.id)).toEqual(bodyZero.rows.map((r) => r.id));
    expect(bodyFraction.rows).toHaveLength(2);
  });

  // "25e-1" (notação científica) é 2.5: >= 1, então só o `Number.isInteger`
  // pega esse caso — o `n < 1` sozinho não bastaria.
  it("limit em notação científica fracionária (25e-1) cai no default", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Limit assunto notacao cientifica");
    const banca = await createTerm(db, "banca", "Limit banca notacao cientifica");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");
    await createInSubject(subject.id, banca.id, "<p>Q3</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&limit=25e-1`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; total: number };
    expect(body.total).toBe(3);
    expect(body.rows).toHaveLength(3);
  });

  // Fronteira do teto de offset (1_000_000): ainda é um inteiro válido no
  // intervalo, então precisa ser aplicado de verdade — não cair no default.
  it("offset=1000000 (no teto) ainda é aplicado como offset válido", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Offset assunto teto");
    const banca = await createTerm(db, "banca", "Offset banca teto");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=1000000`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; total: number };
    // Só há 2 linhas; um offset de 1 milhão as ultrapassa por completo — se
    // o valor tivesse caído no default (0), as 2 linhas apareceriam aqui.
    expect(body.total).toBe(2);
    expect(body.rows).toHaveLength(0);
  });

  it("offset=1000001 (um acima do teto) cai no default 0", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Offset assunto acima teto");
    const banca = await createTerm(db, "banca", "Offset banca acima teto");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");

    const withAboveMax = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=1000001`,
      {},
      env,
    );
    const withZero = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=0`,
      {},
      env,
    );
    expect(withAboveMax.status).toBe(200);
    const bodyAboveMax = (await withAboveMax.json()) as { rows: { id: string }[] };
    const bodyZero = (await withZero.json()) as { rows: { id: string }[] };
    expect(bodyAboveMax.rows.map((r) => r.id)).toEqual(bodyZero.rows.map((r) => r.id));
    expect(bodyAboveMax.rows).toHaveLength(2);
  });

  // 1e21: acima do teto de offset e também o ponto em que `String(n)` do JS
  // vira notação científica ("1e+21"), que quebrava o bind do D1 com 500
  // antes deste round.
  it("offset=1e21 cai no default 0, sem devolver 500", async () => {
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Offset assunto extremo");
    const banca = await createTerm(db, "banca", "Offset banca extremo");
    await createInSubject(subject.id, banca.id, "<p>Q1</p>");
    await createInSubject(subject.id, banca.id, "<p>Q2</p>");

    const withHuge = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=1e21`,
      {},
      env,
    );
    const withZero = await app().request(
      `/admin/questions?subjectId=${subject.id}&offset=0`,
      {},
      env,
    );
    expect(withHuge.status).toBe(200);
    const bodyHuge = (await withHuge.json()) as { rows: { id: string }[] };
    const bodyZero = (await withZero.json()) as { rows: { id: string }[] };
    expect(bodyHuge.rows.map((r) => r.id)).toEqual(bodyZero.rows.map((r) => r.id));
    expect(bodyHuge.rows).toHaveLength(2);
  });
});
