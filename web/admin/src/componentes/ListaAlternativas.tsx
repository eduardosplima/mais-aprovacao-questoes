"use client";

import { Botao, BotaoIcone, Campo, CONTROLE, IconeExcluir } from "@mais/ui";
import type { TipoQuestao } from "@/lib/api";

export type AlternativaForm = { body: string; isCorrect: boolean };

const LETRAS = "ABCDEFGHIJ";
const MAX = 10;

/** As duas de certo/errado, com corpo fixo (spec §1). */
export const ALTERNATIVAS_VF: AlternativaForm[] = [
  { body: "Certo", isCorrect: true },
  { body: "Errado", isCorrect: false },
];

export function ListaAlternativas({
  tipo,
  alternativas,
  aoMudar,
}: {
  tipo: TipoQuestao;
  alternativas: AlternativaForm[];
  aoMudar: (novas: AlternativaForm[]) => void;
}) {
  function marcarCorreta(indice: number) {
    aoMudar(
      alternativas.map((alt, i) => ({ ...alt, isCorrect: i === indice })),
    );
  }

  if (tipo === "true_false") {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-bold text-txt mb-2">
          Gabarito
        </legend>
        {alternativas.map((alt, i) => (
          <label
            key={alt.body}
            className={`flex items-center gap-3 p-4 rounded-row border cursor-pointer transition-colors ${
              alt.isCorrect
                ? "bg-roxo-bg border-[#d6c9f7]"
                : "bg-white border-borda hover:border-borda-3"
            }`}
          >
            <input
              type="radio"
              name="correta"
              checked={alt.isCorrect}
              onChange={() => marcarCorreta(i)}
              aria-label={`${alt.body} é a resposta`}
            />
            <span className="font-semibold">{alt.body}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[13px] font-bold text-txt mb-2">
        Alternativas
      </legend>

      {alternativas.map((alt, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-10 h-10 shrink-0 rounded-full bg-[#f1f1f4] text-txt-2 font-bold flex items-center justify-center">
            {LETRAS[i]}
          </span>
          <input
            className={CONTROLE}
            aria-label={`Alternativa ${LETRAS[i]}`}
            value={alt.body}
            onChange={(e) =>
              aoMudar(
                alternativas.map((a, j) =>
                  j === i ? { ...a, body: e.target.value } : a,
                ),
              )
            }
          />
          <input
            type="radio"
            name="correta"
            className="w-5 h-5 shrink-0"
            checked={alt.isCorrect}
            onChange={() => marcarCorreta(i)}
            aria-label={`Alternativa ${LETRAS[i]} é a correta`}
          />
          <BotaoIcone
            variante="secundario"
            rotulo={`Remover alternativa ${LETRAS[i]}`}
            icone={<IconeExcluir />}
            disabled={alternativas.length <= 2}
            onClick={() => aoMudar(alternativas.filter((_, j) => j !== i))}
          />
        </div>
      ))}

      {alternativas.length < MAX && (
        <div>
          <Botao
            variante="secundario"
            onClick={() =>
              aoMudar([...alternativas, { body: "", isCorrect: false }])
            }
          >
            Adicionar alternativa
          </Botao>
        </div>
      )}
    </fieldset>
  );
}
