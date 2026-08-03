import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/config/env";
import type { Entitlement } from "../src/db/users";
import { adminTaxonomy } from "../src/routes/admin/taxonomy";

type App = { Bindings: Env; Variables: { entitlement: Entitlement } };

/** Monta as rotas sem os middlewares — eles têm teste próprio (Tasks 5 e 9). */
function app() {
  const a = new Hono<App>();
  a.route("/admin/taxonomy", adminTaxonomy);
  return a;
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("rotas de taxonomia", () => {
  it("cria e lista", async () => {
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "banca", name: "IBFC" }),
      env,
    );
    expect(created.status).toBe(201);

    const list = await app().request("/admin/taxonomy?kind=banca", {}, env);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { terms: { name: string }[] };
    expect(body.terms.some((t) => t.name === "IBFC")).toBe(true);
  });

  it("400 para kind desconhecido na listagem", async () => {
    const res = await app().request("/admin/taxonomy?kind=inventado", {}, env);
    expect(res.status).toBe(400);
  });

  it("400 para kind desconhecido na criação", async () => {
    const res = await app().request(
      "/admin/taxonomy",
      json({ kind: "inventado", name: "X" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400 para nome vazio", async () => {
    const res = await app().request(
      "/admin/taxonomy",
      json({ kind: "banca", name: "   " }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("409 para duplicata ativa", async () => {
    await app().request("/admin/taxonomy", json({ kind: "level", name: "Superior" }), env);
    const dup = await app().request(
      "/admin/taxonomy",
      json({ kind: "level", name: "Superior" }),
      env,
    );
    expect(dup.status).toBe(409);
  });

  it("renomeia", async () => {
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "cargo", name: "Tecnico" }),
      env,
    );
    const { term } = (await created.json()) as { term: { id: string } };

    const res = await app().request(
      `/admin/taxonomy/${term.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Técnico" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { term: { name: string } }).term.name).toBe("Técnico");
  });

  it("apaga (soft) e some da listagem", async () => {
    const created = await app().request(
      "/admin/taxonomy",
      json({ kind: "subject", name: "Direito Penal" }),
      env,
    );
    const { term } = (await created.json()) as { term: { id: string } };

    const del = await app().request(
      `/admin/taxonomy/${term.id}`,
      { method: "DELETE" },
      env,
    );
    expect(del.status).toBe(200);

    const list = await app().request("/admin/taxonomy?kind=subject", {}, env);
    const body = (await list.json()) as { terms: { id: string }[] };
    expect(body.terms.some((t) => t.id === term.id)).toBe(false);
  });

  it("404 ao apagar id inexistente", async () => {
    const res = await app().request(
      "/admin/taxonomy/nao-existe",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(404);
  });
});
