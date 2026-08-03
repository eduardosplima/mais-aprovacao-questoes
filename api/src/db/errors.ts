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
    // O frame de topo do Drizzle ecoa os params da query, e `name` vem do
    // usuário: sem cortar a seção de params, um termo chamado literalmente
    // "UNIQUE constraint failed" faria qualquer falha de infra casar aqui e
    // virar 409 em vez do 500 que de fato é.
    const semParams = e.message.split("\nparams:")[0];
    if (semParams.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
