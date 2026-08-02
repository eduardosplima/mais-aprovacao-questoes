import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import {
  listTerms,
  createTerm,
  renameTerm,
  softDeleteTerm,
  assertKind,
  slugify,
} from "../src/db/taxonomy";

const db = () => getDb(env);

describe("slugify", () => {
  it("normaliza acento, caixa e espaço", () => {
    expect(slugify("Direito Administrativo")).toBe("direito-administrativo");
    expect(slugify("  Ciências   Contábeis ")).toBe("ciencias-contabeis");
  });
});

describe("taxonomy", () => {
  it("cria e lista por kind", async () => {
    await createTerm(db(), "banca", "FCC");
    const bancas = await listTerms(db(), "banca");
    expect(bancas.some((t) => t.name === "FCC")).toBe(true);
  });

  it("não lista termo soft-deletado", async () => {
    const term = await createTerm(db(), "cargo", "Técnico Judiciário");
    expect(await softDeleteTerm(db(), term.id)).toBe(true);
    const cargos = await listTerms(db(), "cargo");
    expect(cargos.some((t) => t.id === term.id)).toBe(false);
  });

  it("permite recriar um nome apagado", async () => {
    const first = await createTerm(db(), "level", "Médio");
    await softDeleteTerm(db(), first.id);
    const second = await createTerm(db(), "level", "Médio");
    expect(second.id).not.toBe(first.id);
  });

  it("recusa nome duplicado ativo no mesmo kind", async () => {
    await createTerm(db(), "subject", "Português");
    await expect(createTerm(db(), "subject", "Português")).rejects.toThrow();
  });

  it("o mesmo nome em kinds diferentes convive", async () => {
    await createTerm(db(), "subject", "Contabilidade");
    await expect(
      createTerm(db(), "cargo", "Contabilidade"),
    ).resolves.toBeTruthy();
  });

  it("renomeia sem mudar o slug já referenciado", async () => {
    const term = await createTerm(db(), "banca", "Vunesp");
    const renamed = await renameTerm(db(), term.id, "VUNESP");
    expect(renamed?.name).toBe("VUNESP");
    expect(renamed?.slug).toBe(term.slug);
  });

  // Esta é a invariante que paga o preço da tabela única.
  it("assertKind recusa termo de outro kind", async () => {
    const cargo = await createTerm(db(), "cargo", "Auditor");
    expect(await assertKind(db(), cargo.id, "cargo")).toBe(true);
    expect(await assertKind(db(), cargo.id, "banca")).toBe(false);
  });

  it("assertKind recusa termo soft-deletado", async () => {
    const banca = await createTerm(db(), "banca", "Quadrix");
    await softDeleteTerm(db(), banca.id);
    expect(await assertKind(db(), banca.id, "banca")).toBe(false);
  });
});
