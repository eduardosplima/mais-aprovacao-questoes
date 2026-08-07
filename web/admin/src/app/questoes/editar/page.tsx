"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Badge,
  Botao,
  Campo,
  Card,
  CONTROLE,
  useToast,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { Editor } from "@/componentes/Editor";
import { SeletorTaxonomia } from "@/componentes/SeletorTaxonomia";
import {
  ALTERNATIVAS_VF,
  ListaAlternativas,
  type AlternativaForm,
} from "@/componentes/ListaAlternativas";
import { Preview } from "@/componentes/Preview";
import {
  api,
  type EntradaQuestao,
  type SituacaoQuestao,
  type TipoQuestao,
} from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const VAZIAS: AlternativaForm[] = [
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
];

function Formulario() {
  const parametros = useSearchParams();
  const id = parametros.get("id");
  const router = useRouter();
  const avisar = useToast();

  const [tipo, setTipo] = useState<TipoQuestao>("multiple_choice");
  const [enunciado, setEnunciado] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [bancaId, setBancaId] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [ano, setAno] = useState("");
  const [alternativas, setAlternativas] = useState<AlternativaForm[]>(VAZIAS);
  const [gabarito, setGabarito] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [situacao, setSituacao] = useState<SituacaoQuestao | null>(null);

  const [carregando, setCarregando] = useState(id !== null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vendoPreview, setVendoPreview] = useState(false);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    api
      .questao(id)
      .then((q) => {
        if (!vivo) return;
        setTipo(q.type);
        setEnunciado(q.statement);
        setSubjectId(q.subjectId);
        setBancaId(q.bancaId);
        setCargoId(q.cargoId ?? "");
        setLevelId(q.levelId ?? "");
        setAno(q.year ? String(q.year) : "");
        setAlternativas(
          q.alternatives.map((a) => ({ body: a.body, isCorrect: a.isCorrect })),
        );
        setGabarito(q.explanation?.body ?? "");
        setVideoUrl(q.explanation?.videoUrl ?? "");
        setSituacao(q.status);
      })
      .catch((falha) => vivo && setErro(mensagemDe(falha)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id]);

  function trocarTipo(novo: TipoQuestao) {
    setTipo(novo);
    // Trocar o tipo troca o conjunto de alternativas: certo/errado tem duas
    // fixas, múltipla escolha volta a quatro vazias.
    setAlternativas(novo === "true_false" ? [...ALTERNATIVAS_VF] : [...VAZIAS]);
  }

  function montarEntrada(): EntradaQuestao {
    return {
      type: tipo,
      statement: enunciado,
      subjectId,
      bancaId,
      cargoId: cargoId || null,
      levelId: levelId || null,
      year: ano ? Number(ano) : null,
      alternatives: alternativas.map((a) => ({
        body: a.body,
        isCorrect: a.isCorrect,
      })),
      explanation: { body: gabarito, videoUrl: videoUrl || null },
    };
  }

  async function salvar(status: SituacaoQuestao) {
    setErro(null);
    setSalvando(true);
    try {
      if (id) {
        // PATCH não carrega status de propósito (api/src/routes/admin/
        // questions.ts:73-84). Situação muda pelos botões de publicar.
        await api.salvarQuestao(id, montarEntrada());
        avisar("Questão salva.");
      } else {
        await api.criarQuestao(montarEntrada(), status);
        avisar(status === "published" ? "Questão publicada." : "Rascunho salvo.");
        router.push("/");
      }
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function alternarSituacao() {
    if (!id || !situacao) return;
    try {
      if (situacao === "published") {
        await api.despublicar(id);
        setSituacao("draft");
        avisar("Questão despublicada.");
      } else {
        await api.publicar(id);
        setSituacao("published");
        avisar("Questão publicada.");
      }
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  if (carregando) {
    return <p className="text-txt-2">Carregando…</p>;
  }

  return (
    <div className="flex flex-col gap-5 max-w-[900px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-display text-2xl font-bold">
          {id ? "Editar questão" : "Nova questão"}
        </h1>
        <div className="flex items-center gap-3">
          {situacao && (
            <Badge tom={situacao === "published" ? "ok" : "neutro"}>
              {situacao === "published" ? "Publicada" : "Rascunho"}
            </Badge>
          )}
          <Botao
            variante="secundario"
            onClick={() => setVendoPreview((v) => !v)}
          >
            {vendoPreview ? "Voltar a editar" : "Pré-visualizar"}
          </Botao>
        </div>
      </div>

      {vendoPreview ? (
        <Preview
          tipo={tipo}
          enunciado={enunciado}
          alternativas={alternativas}
          gabarito={gabarito}
          videoUrl={videoUrl || null}
        />
      ) : (
        <>
          <Card className="p-5 flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <Campo rotulo="Tipo" htmlFor="tipo">
                <select
                  id="tipo"
                  className={CONTROLE}
                  value={tipo}
                  onChange={(e) => trocarTipo(e.target.value as TipoQuestao)}
                >
                  <option value="multiple_choice">Múltipla escolha</option>
                  <option value="true_false">Certo/errado</option>
                </select>
              </Campo>
              <SeletorTaxonomia
                kind="subject"
                valor={subjectId}
                aoMudar={setSubjectId}
                obrigatorio
              />
              <SeletorTaxonomia
                kind="banca"
                valor={bancaId}
                aoMudar={setBancaId}
                obrigatorio
              />
              <SeletorTaxonomia kind="cargo" valor={cargoId} aoMudar={setCargoId} />
              <SeletorTaxonomia kind="level" valor={levelId} aoMudar={setLevelId} />
              <Campo rotulo="Ano" htmlFor="ano" dica="Opcional">
                <input
                  id="ano"
                  className={CONTROLE}
                  inputMode="numeric"
                  value={ano}
                  onChange={(e) => setAno(e.target.value.replace(/\D/g, ""))}
                />
              </Campo>
            </div>

            <Campo rotulo="Enunciado">
              <Editor
                valor={enunciado}
                aoMudar={setEnunciado}
                rotulo="Enunciado"
                comTabela
                minAltura={200}
              />
            </Campo>
          </Card>

          <Card className="p-5">
            <ListaAlternativas
              tipo={tipo}
              alternativas={alternativas}
              aoMudar={setAlternativas}
            />
          </Card>

          <Card className="p-5 flex flex-col gap-5">
            <Campo rotulo="Gabarito comentado">
              <Editor
                valor={gabarito}
                aoMudar={setGabarito}
                rotulo="Gabarito comentado"
                minAltura={160}
              />
            </Campo>
            <Campo
              rotulo="Vídeo do gabarito"
              htmlFor="video"
              dica="Opcional. Endereço http ou https."
            >
              <input
                id="video"
                className={CONTROLE}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </Campo>
          </Card>
        </>
      )}

      {erro && (
        <p role="alert" className="font-semibold text-erro">
          {erro}
        </p>
      )}

      <div className="flex gap-3 flex-wrap">
        {id ? (
          <>
            <Botao carregando={salvando} onClick={() => void salvar("draft")}>
              Salvar
            </Botao>
            <Botao variante="secundario" onClick={() => void alternarSituacao()}>
              {situacao === "published" ? "Despublicar" : "Publicar"}
            </Botao>
          </>
        ) : (
          <>
            <Botao
              variante="secundario"
              carregando={salvando}
              onClick={() => void salvar("draft")}
            >
              Salvar rascunho
            </Botao>
            <Botao carregando={salvando} onClick={() => void salvar("published")}>
              Publicar
            </Botao>
          </>
        )}
        <Botao variante="secundario" onClick={() => router.push("/")}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

export default function PaginaEditor() {
  // useSearchParams exige Suspense no App Router.
  return (
    <Layout>
      <Suspense fallback={<p className="text-txt-2">Carregando…</p>}>
        <Formulario />
      </Suspense>
    </Layout>
  );
}
