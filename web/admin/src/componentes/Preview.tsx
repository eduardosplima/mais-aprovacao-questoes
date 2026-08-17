"use client";

import { Card } from "@mais/ui";
import type { AlternativaForm } from "./ListaAlternativas";
import type { TipoQuestao } from "@/lib/api";
import { vazio } from "@/lib/validacao";

const LETRAS = "ABCDEFGHIJ";

/**
 * A questão como o aluno a verá — o layout vem de `docs/demo.html`, e é por
 * isso que os estilos aqui saem dos mesmos tokens que o sub-projeto 4 vai
 * consumir. A diferença é que aqui o gabarito já aparece aberto: quem está
 * conferindo é quem cadastrou.
 */
export function Preview({
  tipo,
  enunciado,
  alternativas,
  gabarito,
  videoUrl,
}: {
  tipo: TipoQuestao;
  enunciado: string;
  alternativas: AlternativaForm[];
  gabarito: string;
  videoUrl: string | null;
}) {
  return (
    <Card className="p-6 md:p-7 flex flex-col gap-6">
      <div
        className="prosa text-[17px] font-bold"
        dangerouslySetInnerHTML={{ __html: enunciado }}
      />

      <div className="flex flex-col gap-3">
        {alternativas.map((alt, i) => (
          <div
            key={i}
            data-testid={alt.isCorrect ? "alternativa-correta" : "alternativa"}
            className={`flex items-center gap-4 p-4 rounded-row border ${
              alt.isCorrect
                ? "bg-ok-bg border-[#bfe7cc]"
                : "bg-white border-borda"
            }`}
          >
            <span
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold ${
                alt.isCorrect ? "bg-ok text-white" : "bg-[#f1f1f4] text-txt-2"
              }`}
            >
              {tipo === "true_false" ? (alt.body === "Certo" ? "C" : "E") : LETRAS[i]}
            </span>
            <span className="text-[15.5px]">{alt.body || "—"}</span>
          </div>
        ))}
      </div>

      {/* Ausência é legítima desde que o gabarito virou opcional — sem esta
          checagem, uma questão sem gabarito pré-visualiza com um cartão
          vazio. */}
      {(!vazio(gabarito) || videoUrl) && (
        <div className="rounded-row border border-borda bg-[#fcfbff] p-5">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-roxo mb-3">
            Gabarito comentado
          </h4>
          {videoUrl && (
            <p className="mb-3 text-[14px]">
              Vídeo:{" "}
              <a
                href={videoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-roxo underline"
              >
                {videoUrl}
              </a>
            </p>
          )}
          <div className="prosa" dangerouslySetInnerHTML={{ __html: gabarito }} />
        </div>
      )}
    </Card>
  );
}
