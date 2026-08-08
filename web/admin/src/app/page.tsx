"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Botao,
  BotaoIcone,
  Campo,
  Card,
  classesBotaoIcone,
  CONTROLE,
  Controle,
  IconeAdicionar,
  IconeDespublicar,
  IconeEditar,
  IconeExcluir,
  IconePublicar,
  IconeSituacao,
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
  // DOMParser não executa script nem busca recurso, e decodifica entidades —
  // o que o regex anterior errava em dois pontos: `&amp;` aparecia cru na
  // tela, e um `>` dentro de um atributo (ex.: alt="x > y") cortava a tag no
  // lugar errado e deixava sobra de marcação colada no texto.
  const texto = (
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
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
  // Descarta respostas fora de ordem: se o pedido do filtro A responder
  // depois do B, o resultado de A não pode sobrescrever a tela que já
  // corresponde ao que os <select> mostram.
  const idRequisicao = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++idRequisicao.current;
    setCarregando(true);
    setErro(null);
    try {
      let paginaAlvo = pagina;
      let dados = await api.questoes({
        ...filtros,
        limit: POR_PAGINA,
        offset: paginaAlvo * POR_PAGINA,
      });
      if (id !== idRequisicao.current) return;

      // Uma exclusão pode encolher o total abaixo da página em que o
      // operador está; a API não clampa o offset (devolve `rows: []`), então
      // sem isso a tela mostraria "nenhuma questão" com registros vivos
      // escondidos atrás dela, e sem paginação visível para voltar. Recua
      // para a última página válida e refaz a busca — não zera para 0 cego,
      // porque quem excluiu um item na página 3 de 10 quer continuar na 3.
      const ultimaPaginaValida = Math.max(
        0,
        Math.ceil(dados.total / POR_PAGINA) - 1,
      );
      if (paginaAlvo > ultimaPaginaValida) {
        paginaAlvo = ultimaPaginaValida;
        dados = await api.questoes({
          ...filtros,
          limit: POR_PAGINA,
          offset: paginaAlvo * POR_PAGINA,
        });
        if (id !== idRequisicao.current) return;
      }

      setLinhas(dados.rows);
      setTotal(dados.total);
      if (paginaAlvo !== pagina) setPagina(paginaAlvo);
    } catch (falha) {
      if (id !== idRequisicao.current) return;
      // Filtro inválido responde 400 com código por campo. Mostrar o erro em
      // vez de cair para "sem filtro" é o ponto da regra: uma lista completa
      // exibida como se estivesse filtrada mente sobre o acervo.
      setErro(mensagemDe(falha));
      setLinhas([]);
      setTotal(0);
    } finally {
      if (id === idRequisicao.current) setCarregando(false);
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
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Clicar na linha também abre o editor, mas é conveniência, não a
              única via — sem um link explícito, quem navega só pelo teclado
              não tem como reabrir uma questão (a linha não é focável de
              propósito, ver Tabela.tsx). */}
          <Link
            href={`/questoes/editar?id=${l.id}`}
            title="Editar"
            aria-label="Editar"
            className={classesBotaoIcone()}
          >
            <IconeEditar />
          </Link>
          <BotaoIcone
            rotulo={l.status === "published" ? "Despublicar" : "Publicar"}
            icone={
              l.status === "published" ? <IconeDespublicar /> : <IconePublicar />
            }
            onClick={() => void alternarSituacao(l)}
          />
          <BotaoIcone
            variante="perigo"
            rotulo="Excluir"
            icone={<IconeExcluir />}
            onClick={() => setAExcluir(l)}
          />
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
          <Botao>
            <IconeAdicionar />
            Nova questão
          </Botao>
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
            <Controle icone={<IconeSituacao />}>
              <select
                id="filtro-situacao"
                className={`${CONTROLE} pl-11`}
                value={filtros.status ?? ""}
                onChange={(e) => mudarFiltro("status", e.target.value)}
              >
                <option value="">Todas</option>
                <option value="draft">Rascunho</option>
                <option value="published">Publicada</option>
              </select>
            </Controle>
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
