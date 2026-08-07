"use client";

import { useEffect, useState } from "react";
import { Campo, CONTROLE } from "@mais/ui";
import { api, type TipoTermo, type Termo } from "@/lib/api";

const ROTULO: Record<TipoTermo, string> = {
  subject: "Assunto",
  banca: "Banca",
  cargo: "Cargo",
  level: "Nível",
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
  return (
    <Campo rotulo={rotulo ?? ROTULO[kind]} htmlFor={id} erro={erro}>
      <select
        id={id}
        className={CONTROLE}
        value={valor}
        required={obrigatorio}
        onChange={(e) => aoMudar(e.target.value)}
      >
        {/* Valor vazio = sem filtro. A API normaliza string vazia para
            ausente, mas o cliente nem chega a mandar (lib/api.ts). */}
        <option value="">{obrigatorio ? "Selecione…" : "Todos"}</option>
        {termos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </Campo>
  );
}
