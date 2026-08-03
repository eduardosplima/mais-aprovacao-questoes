import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import { isUniqueViolation } from "../src/db/errors";
import {
  listTerms,
  createTerm,
  renameTerm,
  softDeleteTerm,
  assertKind,
  slugify,
  type TermKind,
  type TermRow,
} from "../src/db/taxonomy";

const db = () => getDb(env);

// Fixture para os testes que não estão testando duplicata: `createTerm` e
// `renameTerm` agora devolvem `Failure` em vez de lançar numa violação de
// UNIQUE, então o "caminho feliz" precisa estreitar o tipo. Os testes que
// exercitam a duplicata em si chamam `createTerm`/`renameTerm` diretamente.
async function mustCreateTerm(kind: TermKind, name: string): Promise<TermRow> {
  const row = await createTerm(db(), kind, name);
  if ("error" in row) throw new Error(`duplicata inesperada no fixture: ${name}`);
  return row;
}

async function mustRenameTerm(id: string, name: string): Promise<TermRow> {
  const row = await renameTerm(db(), id, name);
  if (row === null) throw new Error("termo não encontrado no fixture");
  if ("error" in row) throw new Error(`duplicata inesperada no fixture: ${name}`);
  return row;
}

describe("slugify", () => {
  it("normaliza acento, caixa e espaço", () => {
    expect(slugify("Direito Administrativo")).toBe("direito-administrativo");
    expect(slugify("  Ciências   Contábeis ")).toBe("ciencias-contabeis");
  });
});

describe("taxonomy", () => {
  it("cria e lista por kind", async () => {
    await mustCreateTerm("banca", "FCC");
    const bancas = await listTerms(db(), "banca");
    expect(bancas.some((t) => t.name === "FCC")).toBe(true);
  });

  it("não lista termo soft-deletado", async () => {
    const term = await mustCreateTerm("cargo", "Técnico Judiciário");
    expect(await softDeleteTerm(db(), term.id)).toBe(true);
    const cargos = await listTerms(db(), "cargo");
    expect(cargos.some((t) => t.id === term.id)).toBe(false);
  });

  it("permite recriar um nome apagado", async () => {
    const first = await mustCreateTerm("level", "Médio");
    await softDeleteTerm(db(), first.id);
    const second = await mustCreateTerm("level", "Médio");
    expect(second.id).not.toBe(first.id);
  });

  it("recusa nome duplicado ativo no mesmo kind", async () => {
    await mustCreateTerm("subject", "Português");
    const res = await createTerm(db(), "subject", "Português");
    expect(res).toEqual({ error: "duplicate" });
  });

  // O ponto do exercício: uma exceção que não é violação de UNIQUE (aqui,
  // uma linha com `kind` nulo, contra o D1 de verdade — não um mock) não
  // pode ser engolida como se fosse duplicata; ela precisa continuar subindo.
  it("createTerm relança exceção que não é violação de UNIQUE", async () => {
    let caught: unknown;
    try {
      await createTerm(db(), null as unknown as TermKind, "Sem kind");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolation(caught)).toBe(false);
  });

  it("o mesmo nome em kinds diferentes convive", async () => {
    await mustCreateTerm("subject", "Contabilidade");
    await expect(
      createTerm(db(), "cargo", "Contabilidade"),
    ).resolves.toBeTruthy();
  });

  // O slug segue o nome. Ele não tem consumidor fora do índice parcial — nenhuma
  // FK aponta para ele, nenhuma rota o recebe como filtro —, então congelá-lo
  // exigiria uma segunda regra de unicidade em código de aplicação, ao lado da
  // que o índice já impõe. Recalculando, o índice cobre criação e rename com a
  // mesma regra.
  it("renomear recalcula o slug", async () => {
    const term = await mustCreateTerm("banca", "Vunesp");
    const renamed = await mustRenameTerm(term.id, "Fundação Vunesp");
    expect(renamed.name).toBe("Fundação Vunesp");
    expect(renamed.slug).toBe("fundacao-vunesp");
  });

  it("renomear para um nome que só muda em acento e caixa mantém o slug", async () => {
    const term = await mustCreateTerm("banca", "Cebraspe");
    const renamed = await mustRenameTerm(term.id, "CEBRASPE");
    expect(renamed.slug).toBe(term.slug);
  });

  it("renomear para o nome de outro termo ativo do mesmo kind é recusado", async () => {
    await mustCreateTerm("subject", "Direito Civil");
    const outro = await mustCreateTerm("subject", "Direito Penal");
    const res = await renameTerm(db(), outro.id, "Direito Civil");
    expect(res).toEqual({ error: "duplicate" });
  });

  it("renomear para o nome de um termo apagado funciona", async () => {
    const morto = await mustCreateTerm("cargo", "Analista Legado");
    await softDeleteTerm(db(), morto.id);
    const vivo = await mustCreateTerm("cargo", "Analista Novo");
    const renamed = await mustRenameTerm(vivo.id, "Analista Legado");
    expect(renamed.slug).toBe("analista-legado");
  });

  it("o nome antigo fica livre depois do rename", async () => {
    const term = await mustCreateTerm("level", "Fundamental");
    await mustRenameTerm(term.id, "Ensino Fundamental");
    await expect(createTerm(db(), "level", "Fundamental")).resolves.toBeTruthy();
  });

  // Esta é a invariante que paga o preço da tabela única.
  it("assertKind recusa termo de outro kind", async () => {
    const cargo = await mustCreateTerm("cargo", "Auditor");
    expect(await assertKind(db(), cargo.id, "cargo")).toBe(true);
    expect(await assertKind(db(), cargo.id, "banca")).toBe(false);
  });

  it("assertKind recusa termo soft-deletado", async () => {
    const banca = await mustCreateTerm("banca", "Quadrix");
    await softDeleteTerm(db(), banca.id);
    expect(await assertKind(db(), banca.id, "banca")).toBe(false);
  });
});
