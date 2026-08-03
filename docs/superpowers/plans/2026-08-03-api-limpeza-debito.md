# Limpeza do débito técnico da API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o bloco de limpeza da §7.1 do spec `2026-08-02-admin-conteudo-design.md`, deixando a API pronta para o painel ser construído contra ela.

**Architecture:** Cinco mudanças independentes em `api/`, cada uma um commit com seu próprio ciclo de teste. Duas são pré-requisito do painel (forma do `POST`, convenção de query param); as outras três fecham dívida sem consumidor externo. Nenhuma toca migração — o schema do banco não muda.

**Tech Stack:** TypeScript · Hono · Drizzle ORM (D1/SQLite) · Zod · Vitest com `@cloudflare/vitest-pool-workers` (Miniflare + D1 local).

## Global Constraints

- **Nenhum pacote novo.** Spec §4 e `~/.claude/CLAUDE.md` §5. Tudo aqui usa o que já está no `package.json`: `hono`, `drizzle-orm`, `zod`, `jose`.
- **`npm ci`, nunca `npm install`.** Nenhuma task deste plano precisa instalar nada.
- **Nenhuma migração nova.** Nenhuma task altera `api/migrations/`. O schema do banco é o mesmo do fim da branch `feat/admin-api`.
- **O filtro de soft delete vive só em `src/db/questions.ts` e `src/db/taxonomy.ts`.** Spec §1. Nenhuma rota monta query direto.
- **Todo HTML de conteúdo é sanitizado na escrita**, por `src/lib/sanitizeHtml.ts`. Spec §3. Nenhuma task muda isso.
- **Comentários e mensagens de commit em português**, seguindo o padrão da branch anterior (`feat(api):`, `fix(api):`, `test(api):`, `docs:`).
- **Branch de trabalho:** `chore/api-limpeza-debito`, já criada, com o commit `fba0174` (a triagem no spec) como base.
- **Todo comando roda a partir de `api/`.**

---

### Task 1: `status` no `POST /admin/questions`

Fecha o item "Publicar exige dois round-trips" da §7.1. É pré-requisito do editor do painel: o botão "Publicar" de uma questão nova precisa de uma chamada só.

**Files:**
- Modify: `api/src/db/questions.ts:134-164` (assinatura de `createQuestion`)
- Modify: `api/src/routes/admin/questions.ts:27-46,103-115` (schema de criação e handler do POST)
- Modify: `api/README.md:85` (linha do `POST /admin/questions`)
- Test: `api/test/admin-questions.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `createQuestion(db: Db, input: QuestionInput, createdBy: string | null, status?: QuestionStatus): Promise<{ id: string } | { error: string }>` — o 4º parâmetro é novo, com default `"draft"`.
  - `QuestionInput` **não** ganha `status`. Ele é parâmetro separado justamente para `updateQuestion`, que recebe o mesmo tipo, não conseguir carregá-lo.

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim do `describe("rotas de questões", ...)` em `api/test/admin-questions.test.ts`, antes do `});` que fecha o bloco (hoje na linha 221):

```typescript
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
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run test/admin-questions.test.ts -t "status"`

Expected: FAIL. O primeiro caso recebe `"draft"` esperando `"published"` (o `status` do corpo é ignorado hoje). O caso de `status=publicado` recebe 201 esperando 400 (campo desconhecido é descartado pelo Zod, não recusado). Os outros dois já passam — são as regressões que a mudança não pode quebrar.

- [ ] **Step 3: Aceitar `status` em `createQuestion`**

Em `api/src/db/questions.ts`, troque a assinatura e o valor gravado (linhas 134-160):

```typescript
export async function createQuestion(
  db: Db,
  input: QuestionInput,
  createdBy: string | null,
  status: QuestionStatus = "draft",
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
      status,
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();
```

O resto da função (`writeChildren`, `return { id }`) fica como está.

Note que `status` é **parâmetro**, não campo de `QuestionInput`: `updateQuestion` recebe `QuestionInput` e por isso fica estruturalmente incapaz de alterar status.

- [ ] **Step 4: Separar o schema de criação do de edição**

Em `api/src/routes/admin/questions.ts`, logo depois do `questionSchema` (que termina hoje na linha 46), acrescente:

```typescript
/**
 * Só na criação. "Salvar rascunho" e "Publicar" são a mesma chamada — é o
 * "cadastro em um step" da spec §2.
 *
 * Deliberadamente um schema separado, não um campo em `questionSchema`: as duas
 * rotas compartilham aquele objeto, e um `status` com default nele faria todo
 * PATCH carregar `status: "draft"` e despublicar em silêncio a questão que
 * alguém só quis corrigir. O PATCH fica com o schema base, que não tem o campo.
 */
const createSchema = questionSchema.extend({
  status: z.enum(["draft", "published"]).default("draft"),
});
```

Troque o handler do POST (linhas 103-115) para usar o schema novo e repassar o status:

```typescript
adminQuestions.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const res = await createQuestion(
    getDb(c.env),
    parsed.data as QuestionInput,
    c.get("entitlement")?.userId ?? null,
    parsed.data.status,
  );
  if ("error" in res) return c.json({ error: res.error }, statusFor(res.error));
  return c.json({ id: res.id }, 201);
});
```

O handler do PATCH (linha 123) **não muda**: continua usando `questionSchema`.

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run test/admin-questions.test.ts`

Expected: PASS, incluindo os 4 casos novos e os 24 que já existiam.

- [ ] **Step 6: Atualizar o README**

Em `api/README.md`, troque a linha 85:

```markdown
| POST | `/admin/questions` | Cria a questão inteira; `status` opcional (`draft` por default) publica no mesmo envio. 422 com código quando viola invariante |
```

- [ ] **Step 7: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS nos dois.

- [ ] **Step 8: Commit**

```bash
git add src/db/questions.ts src/routes/admin/questions.ts test/admin-questions.test.ts README.md
git commit -m "feat(api): POST de questão aceita status e publica num round-trip

O schema de criação é separado do de edição de propósito: as duas rotas
compartilhavam o mesmo objeto Zod, e um \`status\` com default nele faria todo
PATCH carregar \"draft\" e despublicar em silêncio a questão que alguém só quis
corrigir. \`status\` também é parâmetro de createQuestion, não campo de
QuestionInput, para updateQuestion não conseguir alterá-lo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: convenção de query param inválido

Fecha o item "400 na taxonomia, ignorado silenciosamente nas questões". Pré-requisito do painel: a tela de lista monta filtros e precisa saber quando um deles não valeu.

**A regra, e o critério que a decidiu:** filtro inválido responde 400; paginação inválida cai no default. Não é "validado ou não" — é **se descartar em silêncio muda o que o operador acredita estar vendo**. Um filtro descartado muda (quem digita `status=publicado` recebe o acervo inteiro, rascunhos incluídos, com a tela dizendo que filtrou). Um `limit` que cai no default não muda.

`subjectId`, `bancaId`, `cargoId` e `levelId` continuam passando crus: são ids opacos, um id inexistente devolve lista vazia, e isso é honesto — não há como distinguir "malformado" de "não existe".

**Files:**
- Modify: `api/src/routes/admin/questions.ts:1-14` (import), `:87-101` (handler do GET)
- Modify: `api/README.md:84` (linha do `GET /admin/questions`)
- Test: `api/test/admin-questions.test.ts`

**Interfaces:**
- Consumes: Task 1 já mexeu neste arquivo; nenhuma dependência de símbolo.
- Produces: `GET /admin/questions` responde `400 { error: "invalid_status" }` e `400 { error: "invalid_year" }`. O painel lê `error` para dizer qual filtro recusou.

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim do `describe("rotas de questões", ...)` em `api/test/admin-questions.test.ts`:

```typescript
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
    const db = getDb(env);
    const subject = await createTerm(db, "subject", "Year assunto");
    const banca = await createTerm(db, "banca", "Year banca");
    await app().request(
      "/admin/questions",
      post({
        type: "multiple_choice",
        statement: "<p>Q</p>",
        subjectId: subject.id,
        bancaId: banca.id,
        year: 2024,
        alternatives: [
          { body: "<p>A</p>", isCorrect: true },
          { body: "<p>B</p>", isCorrect: false },
        ],
        explanation: { body: "<p>C</p>" },
      }),
      env,
    );

    const res = await app().request(
      `/admin/questions?subjectId=${subject.id}&year=2024`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });

  // A outra metade da convenção: paginação inválida NÃO vira 400. Clampar o
  // limit não mente sobre o conteúdo, então segue caindo no default.
  it("limit inválido continua caindo no default, sem virar 400", async () => {
    const res = await app().request("/admin/questions?limit=99999", {}, env);
    expect(res.status).toBe(200);
  });

  // Id opaco de filtro passa cru: "malformado" e "não existe" são
  // indistinguíveis, e lista vazia é a resposta honesta para os dois.
  it("subjectId inexistente devolve lista vazia, não 400", async () => {
    const res = await app().request("/admin/questions?subjectId=nao-existe", {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run test/admin-questions.test.ts -t "invalid"`

Expected: FAIL nos dois primeiros — recebem 200 esperando 400, porque hoje o filtro inválido é descartado em silêncio.

- [ ] **Step 3: Validar os filtros no handler do GET**

Em `api/src/routes/admin/questions.ts`, acrescente `QuestionStatus` ao import de `../../db/questions` (linha 6-14), que hoje termina em `type QuestionInput,`:

```typescript
  type QuestionInput,
  type QuestionStatus,
} from "../../db/questions";
```

Troque o handler do GET (linhas 87-101):

```typescript
// Filtro inválido responde 400; paginação inválida cai no default. O critério
// não é "validado ou não", é se descartar em silêncio muda o que o operador
// acredita estar vendo: um filtro descartado faz a tela mostrar o acervo
// inteiro dizendo que filtrou, um `limit` clampado não mente sobre o conteúdo.
//
// Os ids de taxonomia ficam de fora dos dois lados: são opacos, e um id
// inexistente já devolve lista vazia — a resposta honesta tanto para
// "malformado" quanto para "não existe".
adminQuestions.get("/", async (c) => {
  const q = c.req.query();

  let status: QuestionStatus | undefined;
  if (q.status !== undefined) {
    if (q.status !== "draft" && q.status !== "published") {
      return c.json({ error: "invalid_status" }, 400);
    }
    status = q.status;
  }

  let year: number | undefined;
  if (q.year !== undefined) {
    // Mesmo teste de pertencimento a intervalo que `parseInRange` usa, com os
    // limites do schema de escrita. `Number("")` é 0 e cai fora, como deve.
    const n = Number(q.year);
    if (!Number.isInteger(n) || n < 1900 || n > 2200) {
      return c.json({ error: "invalid_year" }, 400);
    }
    year = n;
  }

  const result = await listQuestions(getDb(c.env), {
    subjectId: q.subjectId,
    bancaId: q.bancaId,
    cargoId: q.cargoId,
    levelId: q.levelId,
    year,
    status,
    limit: parseLimit(q.limit),
    offset: parseOffset(q.offset),
  });
  return c.json(result);
});
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run test/admin-questions.test.ts`

Expected: PASS. Confira em especial que o `describe("parsing de limit e offset...")` inteiro continua verde — ele é a metade "paginação cai no default" da convenção.

- [ ] **Step 5: Atualizar o README**

Em `api/README.md`, troque a linha 84:

```markdown
| GET | `/admin/questions` | Lista paginada com filtros (`subjectId`, `bancaId`, `year`, `status`…). Filtro inválido → 400 com o código do campo; `limit`/`offset` inválidos caem no default |
```

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS nos dois.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin/questions.ts test/admin-questions.test.ts README.md
git commit -m "fix(api): filtro inválido na listagem responde 400 em vez de sumir

Fixa a convenção que faltava entre os dois módulos de rota. O critério não é
\"validado ou não\": é se descartar em silêncio muda o que o operador acredita
estar vendo. status=publicado (typo plausível em português) devolvia o acervo
inteiro, rascunhos incluídos, com a tela dizendo que filtrou. Paginação
inválida segue caindo no default, porque clampar o limit não mente sobre o
conteúdo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: violação de UNIQUE vs exceção genérica, e rename recalculando o slug

Fecha dois itens de uma vez: o `catch` que traduz **qualquer** exceção em 409, e os dois termos ativos com o mesmo nome. Viram uma mudança só porque a solução do segundo (deixar o índice parcial impor a unicidade também no rename) só funciona com a do primeiro (saber distinguir a violação do índice de um incidente de infra).

**O detalhe que decide a implementação — verificado empiricamente, não suposto.** O Drizzle embrulha o erro do D1. Numa violação real do índice:

```
err.message      = 'Failed query: insert into "taxonomy_terms" (...) values (?, ?, ...)
                    params: <uuid>,banca,ProbeX,probex,1785770160283'
err.cause.message = 'D1_ERROR: UNIQUE constraint failed: taxonomy_terms.kind,
                     taxonomy_terms.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
```

O texto da constraint **não está em `message`** — está em `cause.message`. Um `err.message.includes("UNIQUE constraint")`, que é o reflexo óbvio, nunca casaria, e toda duplicata viraria 500. Por isso o helper desce a cadeia de `cause`.

Também verificado: `UPDATE` que grava no slug o mesmo valor que a própria linha já tem **não** viola o índice. É o caso do teste `"renomeia"` existente (`Tecnico` → `Técnico`, ambos com slug `tecnico`), que por isso continua passando.

**Files:**
- Create: `api/src/db/errors.ts`
- Modify: `api/src/db/taxonomy.ts:58-75` (`renameTerm`)
- Modify: `api/src/routes/admin/taxonomy.ts:31-55` (handlers de POST e PATCH)
- Modify: `api/README.md:82` (linha do `PATCH /admin/taxonomy/:id`)
- Test: `api/test/db-errors.test.ts` (novo), `api/test/taxonomy.test.ts`, `api/test/admin-taxonomy.test.ts`

**Interfaces:**
- Consumes: nada das Tasks 1 e 2 (arquivos disjuntos).
- Produces:
  - `isUniqueViolation(err: unknown): boolean` em `src/db/errors.ts`.
  - `renameTerm(db: Db, id: string, name: string): Promise<TermRow | null>` — assinatura inalterada, mas agora **lança** quando o nome novo colide com outro termo ativo do mesmo kind.
  - `PATCH /admin/taxonomy/:id` passa a poder responder `409 { error: "duplicate" }`.

- [ ] **Step 1: Escrever o teste do helper**

Crie `api/test/db-errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../src/db/errors";

// A forma real, capturada de uma violação do índice parcial em D1: o Drizzle
// embrulha o erro e deixa o texto da constraint só em `cause`. Um matcher
// sobre `message` não veria nada — e toda duplicata viraria 500.
const drizzleWrapped = () => {
  const err = new Error(
    'Failed query: insert into "taxonomy_terms" ("id", "kind") values (?, ?)\nparams: abc,banca',
  );
  err.cause = new Error(
    "D1_ERROR: UNIQUE constraint failed: taxonomy_terms.kind, taxonomy_terms.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
  );
  return err;
};

describe("isUniqueViolation", () => {
  it("reconhece a violação de UNIQUE embrulhada pelo Drizzle", () => {
    expect(isUniqueViolation(drizzleWrapped())).toBe(true);
  });

  it("reconhece quando a constraint está no erro de topo", () => {
    expect(
      isUniqueViolation(new Error("UNIQUE constraint failed: taxonomy_terms.slug")),
    ).toBe(true);
  });

  // O ponto do exercício: indisponibilidade de infra não pode virar
  // "esse nome já existe" no painel.
  it("não reconhece falha de infra do D1", () => {
    expect(isUniqueViolation(new Error("D1_ERROR: Network connection lost"))).toBe(false);
  });

  it("não reconhece outra constraint do SQLite", () => {
    const err = new Error("Failed query: insert into questions");
    err.cause = new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT");
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("não quebra com valor que não é Error", () => {
    expect(isUniqueViolation("boom")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("não entra em laço com cadeia de cause circular", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npx vitest run test/db-errors.test.ts`

Expected: FAIL ao importar — `Cannot find module '../src/db/errors'`.

- [ ] **Step 3: Escrever o helper**

Crie `api/src/db/errors.ts`:

```typescript
/**
 * Distingue a violação do índice único de qualquer outra exceção de escrita.
 *
 * Existe porque o Drizzle embrulha o erro do D1: `err.message` traz só a query
 * e os params, e o texto da constraint fica em `err.cause.message`. Um matcher
 * sobre `message` não casaria nunca, e toda duplicata viraria 500.
 *
 * Sem essa distinção, o `catch` genérico da rota traduzia qualquer exceção em
 * 409 — uma indisponibilidade do D1 fazia o painel dizer "esse nome já existe",
 * escondendo incidente de infra atrás de mensagem de validação.
 */
export function isUniqueViolation(err: unknown): boolean {
  // A cadeia de `cause` vem de biblioteca, não da nossa escrita: o limite de
  // profundidade evita laço infinito se ela vier circular.
  const seen = new Set<unknown>();
  for (let e: unknown = err; e instanceof Error && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `npx vitest run test/db-errors.test.ts`

Expected: PASS, 6 casos.

- [ ] **Step 5: Trocar o teste que afirmava o slug congelado**

Em `api/test/taxonomy.test.ts`, substitua o teste das linhas 55-60 inteiro:

```typescript
  // O slug segue o nome. Ele não tem consumidor fora do índice parcial — nenhuma
  // FK aponta para ele, nenhuma rota o recebe como filtro —, então congelá-lo
  // exigiria uma segunda regra de unicidade em código de aplicação, ao lado da
  // que o índice já impõe. Recalculando, o índice cobre criação e rename com a
  // mesma regra.
  it("renomear recalcula o slug", async () => {
    const term = await createTerm(db(), "banca", "Vunesp");
    const renamed = await renameTerm(db(), term.id, "Fundação Vunesp");
    expect(renamed?.name).toBe("Fundação Vunesp");
    expect(renamed?.slug).toBe("fundacao-vunesp");
  });

  it("renomear para um nome que só muda em acento e caixa mantém o slug", async () => {
    const term = await createTerm(db(), "banca", "Cebraspe");
    const renamed = await renameTerm(db(), term.id, "CEBRASPE");
    expect(renamed?.slug).toBe(term.slug);
  });

  it("renomear para o nome de outro termo ativo do mesmo kind é recusado", async () => {
    await createTerm(db(), "subject", "Direito Civil");
    const outro = await createTerm(db(), "subject", "Direito Penal");
    await expect(renameTerm(db(), outro.id, "Direito Civil")).rejects.toThrow();
  });

  it("renomear para o nome de um termo apagado funciona", async () => {
    const morto = await createTerm(db(), "cargo", "Analista Legado");
    await softDeleteTerm(db(), morto.id);
    const vivo = await createTerm(db(), "cargo", "Analista Novo");
    const renamed = await renameTerm(db(), vivo.id, "Analista Legado");
    expect(renamed?.slug).toBe("analista-legado");
  });

  it("o nome antigo fica livre depois do rename", async () => {
    const term = await createTerm(db(), "level", "Fundamental");
    await renameTerm(db(), term.id, "Ensino Fundamental");
    await expect(createTerm(db(), "level", "Fundamental")).resolves.toBeTruthy();
  });
```

- [ ] **Step 6: Rodar para confirmar que falham**

Run: `npx vitest run test/taxonomy.test.ts -t "renom"`

Expected: FAIL. `"renomear recalcula o slug"` recebe `vunesp` esperando `fundacao-vunesp`; `"renomear para o nome de outro termo ativo"` resolve em vez de rejeitar; `"o nome antigo fica livre"` rejeita porque o slug velho continua ocupado.

- [ ] **Step 7: Fazer o rename recalcular o slug**

Em `api/src/db/taxonomy.ts`, substitua `renameTerm` (linhas 58-75):

```typescript
/**
 * Renomeia recalculando o slug, que é o que faz o índice parcial recusar dois
 * termos ativos com o mesmo nome também no rename — a mesma regra da criação,
 * escrita num lugar só. A violação estoura daqui; a rota traduz para 409.
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
): Promise<TermRow | null> {
  await db
    .update(taxonomyTerms)
    .set({ name: name.trim(), slug: slugify(name) })
    .where(and(eq(taxonomyTerms.id, id), alive))
    .run();
  const row = await db
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.id, id), alive))
    .get();
  return row ?? null;
}
```

- [ ] **Step 8: Rodar os testes da camada de dados**

Run: `npx vitest run test/taxonomy.test.ts`

Expected: PASS, incluindo os 5 casos de rename.

- [ ] **Step 9: Escrever os testes das rotas**

Em `api/test/admin-taxonomy.test.ts`, adicione dentro do `describe("rotas de taxonomia", ...)`, antes do `});` final (hoje na linha 120):

```typescript
  it("409 ao renomear para o nome de outro termo ativo", async () => {
    await app().request("/admin/taxonomy", json({ kind: "level", name: "Fundamental" }), env);
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "level", name: "Medio" }),
      env,
    );
    const { term } = (await created.json()) as { term: { id: string } };

    const res = await app().request(
      `/admin/taxonomy/${term.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Fundamental" }),
      },
      env,
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "duplicate" });
  });

  it("renomear atualiza o slug e libera o nome antigo", async () => {
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "banca", name: "Instituto AOCP" }),
      env,
    );
    const { term } = (await created.json()) as { term: { id: string } };

    await app().request(
      `/admin/taxonomy/${term.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "AOCP" }),
      },
      env,
    );

    const recriado = await app().request(
      "/admin/taxonomy",
      json({ kind: "banca", name: "Instituto AOCP" }),
      env,
    );
    expect(recriado.status).toBe(201);
  });
```

- [ ] **Step 10: Rodar para confirmar que falham**

Run: `npx vitest run test/admin-taxonomy.test.ts -t "renom"`

Expected: FAIL. O caso do 409 recebe 500 (a exceção do índice sobe sem tratamento no PATCH, que não tem `catch`).

- [ ] **Step 11: Usar o helper nas duas rotas de taxonomia**

Em `api/src/routes/admin/taxonomy.ts`, acrescente ao bloco de imports:

```typescript
import { isUniqueViolation } from "../../db/errors";
```

Substitua os handlers de POST e PATCH (linhas 31-55):

```typescript
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
```

- [ ] **Step 12: Rodar os testes das rotas**

Run: `npx vitest run test/admin-taxonomy.test.ts`

Expected: PASS, incluindo o `"renomeia"` original (`Tecnico` → `Técnico`), que continua verde porque gravar no slug o mesmo valor da própria linha não viola o índice.

- [ ] **Step 13: Atualizar o README**

Em `api/README.md`, troque a linha 82:

```markdown
| PATCH | `/admin/taxonomy/:id` | `{ name }` → renomeia recalculando o slug. 409 se colidir com outro termo ativo do mesmo kind |
```

- [ ] **Step 14: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS nos dois.

- [ ] **Step 15: Commit**

```bash
git add src/db/errors.ts src/db/taxonomy.ts src/routes/admin/taxonomy.ts test/db-errors.test.ts test/taxonomy.test.ts test/admin-taxonomy.test.ts README.md
git commit -m "fix(api): 409 só para violação de UNIQUE, e rename recalcula o slug

Duas correções que só funcionam juntas. O catch genérico traduzia qualquer
exceção em 409, então uma indisponibilidade do D1 chegava ao painel como
\"esse nome já existe\". E o rename não tocava o slug, deixando dois termos
ativos com o mesmo nome no dropdown.

Recalcular o slug faz o índice parcial impor a unicidade no rename com a mesma
regra da criação, sem uma segunda validação em código — mas exige saber
distinguir a violação do índice de um erro de infra, que é o helper novo.

O helper desce a cadeia de \`cause\`: o Drizzle embrulha o erro do D1 e deixa
\`message\` só com a query e os params, com o texto da constraint em
\`cause.message\`. Um matcher sobre \`message\` não casaria nunca.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `videoUrl` aceita só `http` e `https`

Fecha o item do `videoUrl`. O campo reusava `isSafeUrl`, escrita para `href` de conteúdo, onde `mailto:` faz sentido — num campo de vídeo, não faz.

**Correção do enunciado original do débito:** a lista dizia que o campo aceitava caminho relativo e `mailto:`. Só o segundo é verdade — o `z.string().url()` roda antes e já barra caminho relativo e âncora. Os esquemas perigosos (`javascript:`, `data:`, `vbscript:`) sempre foram recusados; não há correção de segurança aqui.

Cloudflare Stream continua sendo o que o campo **significa** (spec técnica §7.2), não o que ele **verifica**: uma allowlist de hostname precisaria do código da conta (`customer-<código>.cloudflarestream.com`), e o Stream ainda não está provisionado.

**Files:**
- Modify: `api/src/routes/admin/questions.ts:15` (import), `:36-45` (campo `videoUrl`)
- Test: `api/test/admin-questions.test.ts:198-220`

**Interfaces:**
- Consumes: o arquivo já foi tocado pelas Tasks 1 e 2; nenhuma dependência de símbolo.
- Produces: `POST`/`PATCH /admin/questions` recusam `videoUrl` que não seja `http:` ou `https:`.

- [ ] **Step 1: Mover `mailto:` para o lado dos recusados**

Em `api/test/admin-questions.test.ts`, substitua os dois `it.each` das linhas 196-220:

```typescript
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
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npx vitest run test/admin-questions.test.ts -t "videoUrl"`

Expected: FAIL no caso `mailto:a@test.com`, que recebe 201 esperando 400. Os casos `/videos/aula.mp4` e `#ancora` já passam — são a regressão do que o `.url()` já barrava.

- [ ] **Step 3: Trocar a validação**

Em `api/src/routes/admin/questions.ts`, **remova** a linha 15:

```typescript
import { isSafeUrl } from "../../lib/sanitizeHtml";
```

Ela fica sem uso depois desta mudança, e este é o único ponto do arquivo que a consumia.

Acrescente, logo antes do `alternativeSchema` (hoje na linha 22):

```typescript
/**
 * Um link de vídeo é http ou https e nada mais.
 *
 * Não reusa `isSafeUrl`: aquela função existe para `href` de conteúdo, onde
 * `mailto:` e caminho relativo são legítimos — num campo de vídeo não são.
 *
 * Cloudflare Stream (spec técnica §7.2) é o que o campo significa, não o que
 * ele verifica: a allowlist de hostname precisaria do código da conta
 * (`customer-<código>.cloudflarestream.com`), e o Stream ainda não foi
 * provisionado. Quando for, aperta-se aqui.
 */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Não é URL absoluta — caminho relativo, âncora, texto solto.
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}
```

Troque o campo `videoUrl` dentro de `questionSchema` (linhas 36-45):

```typescript
  explanation: z.object({
    body: z.string().min(1),
    videoUrl: z
      .string()
      .refine(isHttpUrl, { message: "videoUrl precisa ser http ou https" })
      .nullish(),
  }),
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `npx vitest run test/admin-questions.test.ts`

Expected: PASS, 9 casos de `videoUrl` mais o resto do arquivo.

- [ ] **Step 5: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS nos dois. O typecheck é o que confirma que remover o import de `isSafeUrl` não deixou referência órfã.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/questions.ts test/admin-questions.test.ts
git commit -m "fix(api): videoUrl aceita só http e https

O campo reusava isSafeUrl, que permite mailto: por ter sido escrita para href
de conteúdo. Não era brecha de segurança — javascript:, data: e vbscript:
sempre foram recusados —, era um campo de vídeo aceitando endereço de email.

Cloudflare Stream segue sendo o que o campo significa, não o que ele verifica:
a allowlist de hostname precisa do código da conta, e o Stream ainda não está
provisionado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: higiene — regressão de JSON malformado, comentários e README

Fecha os quatro itens restantes da §7.1. Nenhum muda comportamento; três tornam visível na revisão algo que hoje só o autor sabe, e o primeiro trava uma regressão verificada só à mão.

**Files:**
- Modify: `api/src/db/schema.ts:109-116` (comentário nas FKs de taxonomia)
- Modify: `api/src/db/taxonomy.ts:17-25` (`slugify`)
- Modify: `api/README.md` (segredos, bindings)
- Test: `api/test/admin-taxonomy.test.ts`, `api/test/admin-questions.test.ts`

**Interfaces:**
- Consumes: nada. Nenhuma outra task depende desta.
- Produces: nada consumível por código.

- [ ] **Step 1: Escrever os testes de corpo malformado**

As duas famílias de rota usam `c.req.json().catch(() => null)`, e o 400 foi verificado só manualmente. Em `api/test/admin-taxonomy.test.ts`, adicione dentro do `describe`:

```typescript
  it.each([
    ["corpo que não é JSON", "isso nao e json"],
    ["JSON truncado", '{"kind":"banca","name":'],
    ["corpo vazio", ""],
    ["JSON que não é objeto", '"texto"'],
  ])("400 para %s no POST", async (_label, body) => {
    const res = await app().request(
      "/admin/taxonomy",
      { method: "POST", headers: { "content-type": "application/json" }, body },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 para corpo malformado no PATCH", async () => {
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "subject", name: "Malformado" }),
      env,
    );
    const { term } = (await created.json()) as { term: { id: string } };

    const res = await app().request(
      `/admin/taxonomy/${term.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{{{",
      },
      env,
    );
    expect(res.status).toBe(400);
  });
```

Em `api/test/admin-questions.test.ts`, adicione dentro do `describe("rotas de questões", ...)`:

```typescript
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
```

- [ ] **Step 2: Rodar os testes**

Run: `npx vitest run test/admin-taxonomy.test.ts test/admin-questions.test.ts -t "malformado"` e `npx vitest run test/admin-taxonomy.test.ts test/admin-questions.test.ts -t "400 para"`

Expected: PASS já na primeira execução. Estes são testes de regressão sobre comportamento existente e correto — não há implementação a escrever. Se algum falhar, **pare**: significa que o `catch(() => null)` não cobre aquele formato, e aí há um bug real a corrigir antes de seguir.

- [ ] **Step 3: Declarar o `NO ACTION` das FKs de taxonomia**

Em `api/src/db/schema.ts`, acrescente o comentário logo antes de `subjectId` (linha 109), deixando os quatro campos como estão:

```typescript
    /**
     * Sem `onDelete` de propósito: `NO ACTION` é o padrão do SQLite e é o
     * fail-safe certo aqui. Termo de taxonomia nunca sofre hard delete — o
     * módulo só faz soft delete (`db/taxonomy.ts`) —, então a ação nunca
     * dispara. Se um DELETE cru aparecer um dia, `NO ACTION` recusa apagar um
     * termo em uso, em vez de levar as questões junto (CASCADE) ou deixar a
     * questão sem assunto (SET NULL).
     */
    subjectId: text("subject_id")
      .notNull()
      .references(() => taxonomyTerms.id),
```

- [ ] **Step 4: Tornar o `slugify` legível**

Em `api/src/db/taxonomy.ts`, troque a linha do `replace` de combinantes (linha 19), que hoje traz os caracteres crus e invisíveis na revisão:

```typescript
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
```

- [ ] **Step 5: Rodar os testes do slugify**

Run: `npx vitest run test/taxonomy.test.ts`

Expected: PASS. `slugify("  Ciências   Contábeis ")` continua devolvendo `ciencias-contabeis` — a troca é de notação, não de comportamento.

- [ ] **Step 6: Completar o README**

Em `api/README.md`, no bloco de vars não-secretas (linhas 41-46), troque o parágrafo:

```markdown
As demais variáveis, não-secretas, já vêm de `wrangler.jsonc` (bloco `vars`):
`HOTMART_SUBSCRIPTION_UCODES`, `HOTMART_API_BASE_URL`, `HOTMART_TOKEN_URL`,
`HOTMART_CHECKOUT_URL`, `APP_BASE_URL`, `EMAIL_FROM`, `ADMIN_EMAILS`,
`MEDIA_PUBLIC_BASE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`. Ajuste os
placeholders (`REPLACE_ME`) ali antes de rodar contra o sandbox. Em produção,
os seis segredos vão via `wrangler secret put <NOME>`; as vars continuam em
`wrangler.jsonc`.

Das três últimas: `MEDIA_PUBLIC_BASE` é o hostname **sem cookies** que serve o
bucket R2 (um SVG malicioso não pode executar com a sessão do admin);
`ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` são o domínio do time no Zero Trust e a tag
`aud` da aplicação Access, usados para validar o JWT da borda.
```

E na seção "Bindings e triggers" (linhas 115-119), acrescente o binding do R2:

```markdown
- `DB` — D1 (`mais-aprovacao-db`), migrações em `migrations/`.
- `EMAIL` — `send_email`, usado para o link mágico (primeiro acesso e recuperação).
- `MEDIA` — R2, bucket das imagens de questão (`POST /admin/media`). A chave é
  plana (`media/{uuid}.{ext}`): questão não sofre hard delete, então prefixo por
  questão não serviria para apagar nada.
- `triggers.crons` — `0 3 * * *`, dispara a reconciliação diária.
```

- [ ] **Step 7: Rodar a suíte inteira e o typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS nos dois.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/taxonomy.ts test/admin-taxonomy.test.ts test/admin-questions.test.ts README.md
git commit -m "test(api): trava o 400 de corpo malformado e torna visível o que estava implícito

O 400 para JSON malformado nas rotas de taxonomia e de questões só tinha
verificação manual. As FKs de questions para taxonomy_terms ficam sem onDelete
de propósito — o comentário passa a dizer isso. O slugify usava os
combinantes crus no regex, invisíveis na revisão.

README ganha MEDIA_PUBLIC_BASE, ACCESS_TEAM_DOMAIN, ACCESS_AUD e o binding
MEDIA, que entraram com a API de admin e nunca foram documentados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: fechar a branch

- [ ] **Step 1: Rodar a suíte inteira, o typecheck e a auditoria**

Run: `npm test && npm run typecheck && node ../scripts/audit-osv.mjs`

Expected: testes verdes, typecheck limpo, auditoria sem achados. É o critério de pronto nº 3 do spec.

- [ ] **Step 2: Conferir o diff contra o spec**

Run: `git diff master --stat`

Expected: mudanças apenas em `api/src/db/`, `api/src/routes/admin/`, `api/test/`, `api/README.md` e o commit do spec. **Nenhum arquivo em `api/migrations/`** e **nenhuma mudança em `package.json` ou `package-lock.json`** — se algum aparecer, algo saiu do escopo.

- [ ] **Step 3: Marcar a §7.1 como concluída no spec**

Em `docs/superpowers/specs/2026-08-02-admin-conteudo-design.md`, na §7.1, troque a frase de abertura do bloco:

```markdown
Cinco commits, todos em `api/`. **Concluído na branch `chore/api-limpeza-debito`.**
Os dois primeiros itens da tabela não eram opcionais: o painel é construído
contra a forma do `POST` e contra a convenção de query param.
```

- [ ] **Step 4: Commit e integração**

```bash
git add docs/superpowers/specs/2026-08-02-admin-conteudo-design.md
git commit -m "docs: marca o bloco de limpeza da API como concluído

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Depois use a skill `superpowers:finishing-a-development-branch` para decidir como integrar.
