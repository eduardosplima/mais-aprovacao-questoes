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
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .termos(kind)
      .then((t) => {
        if (!vivo) return;
        setTermos(t);
        setFalhou(false);
      })
      .catch(() => {
        if (!vivo) return;
        setTermos([]);
        setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [kind]);

  // A falha de carga tem precedência sobre o erro de validação: com a lista
  // vazia o operador não consegue escolher nada, e "Escolha o assunto." o
  // culparia por algo que não é dele.
  const mensagem = falhou ? "Não foi possível carregar os termos." : erro;

  const id = `taxonomia-${kind}`;
  const Icone = ICONE[kind];
  return (
    <Campo rotulo={rotulo ?? ROTULO[kind]} htmlFor={id} erro={mensagem}>
      <Controle icone={<Icone />} seta>
        <select
          id={id}
          className={`${CONTROLE} appearance-none pl-11 pr-11 ${mensagem ? CONTROLE_INVALIDO : ""}`}
          aria-invalid={mensagem ? true : undefined}
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
