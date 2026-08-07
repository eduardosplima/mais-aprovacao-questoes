import type { ReactNode } from "react";

export type Coluna<T> = {
  titulo: string;
  celula: (linha: T) => ReactNode;
  /** A coluna que identifica a linha; no mobile vira o título do cartão. */
  principal?: boolean;
};

export function Tabela<T>({
  colunas,
  linhas,
  chave,
  aoClicar,
  vazio = "Nada por aqui ainda.",
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (linha: T) => string;
  aoClicar?: (linha: T) => void;
  vazio?: string;
}) {
  if (linhas.length === 0) {
    return <p className="p-8 text-center text-txt-2">{vazio}</p>;
  }

  return (
    <>
      {/* Desktop */}
      <table className="hidden md:table w-full border-collapse">
        <thead>
          <tr className="border-b border-borda">
            {colunas.map((c) => (
              <th
                key={c.titulo}
                className="text-left px-5 py-3 text-[13px] font-bold text-txt-2"
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={chave(linha)}
              onClick={aoClicar ? () => aoClicar(linha) : undefined}
              className={`border-b border-borda last:border-0 ${
                aoClicar ? "cursor-pointer hover:bg-roxo-bg/40" : ""
              }`}
            >
              {colunas.map((c) => (
                <td key={c.titulo} className="px-5 py-4 text-[14.5px] align-top">
                  {c.celula(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="md:hidden divide-y divide-borda">
        {linhas.map((linha) => (
          <li
            key={chave(linha)}
            onClick={aoClicar ? () => aoClicar(linha) : undefined}
            className={`p-4 flex flex-col gap-2 ${aoClicar ? "cursor-pointer" : ""}`}
          >
            {colunas.map((c) =>
              c.principal ? (
                <div key={c.titulo} className="text-[15px] font-semibold">
                  {c.celula(linha)}
                </div>
              ) : (
                <div key={c.titulo} className="flex gap-2 text-[13.5px]">
                  <span className="text-txt-3 shrink-0">{c.titulo}:</span>
                  <span>{c.celula(linha)}</span>
                </div>
              ),
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
