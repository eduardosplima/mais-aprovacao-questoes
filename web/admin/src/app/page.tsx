"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Botao,
  Campo,
  Card,
  CONTROLE,
  Modal,
  Tabela,
  useToast,
  type Coluna,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { SeletorTaxonomia } from "@/componentes/SeletorTaxonomia";
import { api, type FiltrosQuestao, type LinhaQuestao } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const POR_PAGINA = 50;

/** Enunciado é HTML sanitizado; na tabela queremos texto curto e sem tags. */
function resumo(html: string): string {
  const texto = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
}

export default function PaginaLista() {
  const [filtros, setFiltros] = useState<FiltrosQuestao>({});
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<LinhaQuestao[]>([]);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aExcluir, setAExcluir] = useState<LinhaQuestao | null>(null);
  const avisar = useToast();
  const router = useRouter();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await api.questoes({
        ...filtros,
        limit: POR_PAGINA,
        offset: pagina * POR_PAGINA,
      });
      setLinhas(dados.rows);
      setTotal(dados.total);
    } catch (falha) {
      // Filtro inválido responde 400 com código por campo. Mostrar o erro em
      // vez de cair para "sem filtro" é o ponto da regra: uma lista completa
      // exibida como se estivesse filtrada mente sobre o acervo.
      setErro(mensagemDe(falha));
      setLinhas([]);
      setTotal(0);
    } finally {
      setCarregando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function mudarFiltro(campo: keyof FiltrosQuestao, valor: string) {
    setPagina(0);
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  async function alternarSituacao(linha: LinhaQuestao) {
    try {
      if (linha.status === "published") {
        await api.despublicar(linha.id);
        avisar("Questão despublicada.");
      } else {
        await api.publicar(linha.id);
        avisar("Questão publicada.");
      }
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  async function excluir() {
    if (!aExcluir) return;
    const alvo = aExcluir;
    setAExcluir(null);
    try {
      await api.excluirQuestao(alvo.id);
      avisar("Questão excluída.");
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  const colunas: Coluna<LinhaQuestao>[] = [
    {
      titulo: "Enunciado",
      principal: true,
      celula: (l) => <span className="font-medium">{resumo(l.statement)}</span>,
    },
    { titulo: "Assunto", celula: (l) => l.subjectName ?? "—" },
    { titulo: "Banca", celula: (l) => l.bancaName ?? "—" },
    { titulo: "Ano", celula: (l) => l.year ?? "—" },
    {
      titulo: "Tipo",
      celula: (l) => (
        <Badge tom="neutro">
          {l.type === "true_false" ? "Certo/errado" : "Múltipla escolha"}
        </Badge>
      ),
    },
    {
      titulo: "Situação",
      celula: (l) => (
        <Badge tom={l.status === "published" ? "ok" : "neutro"}>
          {l.status === "published" ? "Publicada" : "Rascunho"}
        </Badge>
      ),
    },
    {
      titulo: "Ações",
      celula: (l) => (
        <div
          className="flex gap-2 flex-wrap"
          onClick={(e) => e.stopPropagation()}
        >
          <Botao
            variante="secundario"
            className="h-9 px-3 text-[13px]"
            onClick={() => void alternarSituacao(l)}
          >
            {l.status === "published" ? "Despublicar" : "Publicar"}
          </Botao>
          <Botao
            variante="perigo"
            className="h-9 px-3 text-[13px]"
            onClick={() => setAExcluir(l)}
          >
            Excluir
          </Botao>
        </div>
      ),
    },
  ];

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <Layout>
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <h1 className="font-display text-2xl font-bold">Questões</h1>
        <Link href="/questoes/editar">
          <Botao>Nova questão</Botao>
        </Link>
      </div>

      <Card className="p-4 md:p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <SeletorTaxonomia
            kind="subject"
            valor={filtros.subjectId ?? ""}
            aoMudar={(v) => mudarFiltro("subjectId", v)}
          />
          <SeletorTaxonomia
            kind="banca"
            valor={filtros.bancaId ?? ""}
            aoMudar={(v) => mudarFiltro("bancaId", v)}
          />
          <SeletorTaxonomia
            kind="cargo"
            valor={filtros.cargoId ?? ""}
            aoMudar={(v) => mudarFiltro("cargoId", v)}
          />
          <SeletorTaxonomia
            kind="level"
            valor={filtros.levelId ?? ""}
            aoMudar={(v) => mudarFiltro("levelId", v)}
          />
          <Campo rotulo="Situação" htmlFor="filtro-situacao">
            <select
              id="filtro-situacao"
              className={CONTROLE}
              value={filtros.status ?? ""}
              onChange={(e) => mudarFiltro("status", e.target.value)}
            >
              <option value="">Todas</option>
              <option value="draft">Rascunho</option>
              <option value="published">Publicada</option>
            </select>
          </Campo>
        </div>
      </Card>

      <Card>
        {carregando && <p className="p-8 text-center text-txt-2">Carregando…</p>}
        {!carregando && erro && (
          <p role="alert" className="p-8 text-center font-semibold text-erro">
            {erro}
          </p>
        )}
        {!carregando && !erro && (
          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(l) => l.id}
            aoClicar={(l) => router.push(`/questoes/editar?id=${l.id}`)}
            vazio="Nenhuma questão encontrada. Use “Nova questão” para cadastrar a primeira."
          />
        )}
      </Card>

      {total > POR_PAGINA && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Botao
            variante="secundario"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </Botao>
          <span className="text-[14.5px] font-semibold text-txt-2">
            {pagina + 1} de {ultimaPagina + 1} · {total} questões
          </span>
          <Botao
            variante="secundario"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Botao>
        </div>
      )}

      <Modal
        aberto={aExcluir !== null}
        titulo="Excluir questão?"
        perigo
        rotuloConfirmar="Excluir"
        aoConfirmar={() => void excluir()}
        aoCancelar={() => setAExcluir(null)}
      >
        A questão sai da lista, mas o registro é preservado — tentativas e
        comentários de alunos continuarão apontando para ela.
      </Modal>
    </Layout>
  );
}
