"use client";

import { useEffect, useState } from "react";
import {
  Campo,
  CONTROLE,
  CONTROLE_INVALIDO,
  Controle,
  IconeAssunto,
  IconeBanca,
  IconeCargo,
  IconeNivel,
  type ComponenteIcone,
} from "@mais/ui";
import { api, type TipoTermo, type Termo } from "@/lib/api";

const ROTULO: Record<TipoTermo, string> = {
  subject: "Assunto",
  banca: "Banca",
  cargo: "Cargo",
  level: "Nível",
};

const ICONE: Record<TipoTermo, ComponenteIcone> = {
  subject: IconeAssunto,
  banca: IconeBanca,
  cargo: IconeCargo,
  level: IconeNivel,
};

export function SeletorTaxonomia({
  kind,
  valor,
  aoMudar,
  rotulo,
  obrigatorio = false,
  erro,
}: {
  kind: TipoTermo;
  valor: string;
  aoMudar: (id: string) => void;
  rotulo?: string;
  obrigatorio?: boolean;
  erro?: string;
}) {
  const [termos, setTermos] = useState<Termo[]>([]);

  useEffect(() => {
    let vivo = true;
    api
      .termos(kind)
      .then((t) => vivo && setTermos(t))
      .catch(() => vivo && setTermos([]));
    return () => {
      vivo = false;
    };
  }, [kind]);

  const id = `taxonomia-${kind}`;
  const Icone = ICONE[kind];
  return (
    <Campo rotulo={rotulo ?? ROTULO[kind]} htmlFor={id} erro={erro}>
      <Controle icone={<Icone />}>
        <select
          id={id}
          className={`${CONTROLE} pl-11 ${erro ? CONTROLE_INVALIDO : ""}`}
          aria-invalid={erro ? true : undefined}
          value={valor}
          required={obrigatorio}
          onChange={(e) => aoMudar(e.target.value)}
        >
          {/* Valor vazio = sem filtro. A API normaliza string vazia para
              ausente, mas o cliente nem chega a mandar (lib/api.ts). */}
          <option value="">{obrigatorio ? "Selecione…" : "Todos"}</option>
          {/* A questão pode apontar para um termo já excluído: a API o mantém
              na questão (updateQuestion só revalida a FK que mudou) mas não o
              devolve na lista de escolha. Sem esta opção fantasma, o select
              cairia no primeiro item e trocaria a taxonomia sem ninguém pedir. */}
          {valor !== "" && !termos.some((t) => t.id === valor) && (
            <option value={valor}>(termo excluído — mantido)</option>
          )}
          {termos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Controle>
    </Campo>
  );
}
