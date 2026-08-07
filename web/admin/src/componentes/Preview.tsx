"use client";

import type { AlternativaForm } from "./ListaAlternativas";
import type { TipoQuestao } from "@/lib/api";

export function Preview(_props: {
  tipo: TipoQuestao;
  enunciado: string;
  alternativas: AlternativaForm[];
  gabarito: string;
  videoUrl: string | null;
}) {
  return <p className="text-txt-2">Pré-visualização em construção.</p>;
}
