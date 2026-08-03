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

  it("não casa com constraint vinda dos params ecoados", () => {
    const err = new Error(
      'Failed query: insert into "taxonomy_terms" ("id", "kind", "name") values (?, ?, ?)\n' +
        "params: abc,banca,UNIQUE constraint failed,x",
    );
    err.cause = new Error("D1_ERROR: Network connection lost");
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("ainda reconhece a constraint num erro não embrulhado, sem params", () => {
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
