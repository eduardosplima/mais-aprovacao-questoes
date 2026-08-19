"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Botao,
  BotaoIcone,
  Campo,
  Card,
  CONTROLE,
  CONTROLE_INVALIDO,
  IconeAdicionar,
  IconeAssunto,
  IconeBanca,
  IconeCargo,
  IconeEditar,
  IconeExcluir,
  IconeNivel,
  IconeSalvar,
  Modal,
  Tabela,
  useToast,
  type Coluna,
  type ComponenteIcone,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { api, type Termo, type TipoTermo } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

// Banca primeiro: é a taxonomia que a operação mais cadastra.
const ABAS: {
  kind: TipoTermo;
  rotulo: string;
  Icone: ComponenteIcone;
}[] = [
  { kind: "banca", rotulo: "Banca", Icone: IconeBanca },
  { kind: "subject", rotulo: "Assunto", Icone: IconeAssunto },
  { kind: "cargo", rotulo: "Cargo", Icone: IconeCargo },
  { kind: "level", rotulo: "Nível", Icone: IconeNivel },
];

export default function PaginaTaxonomias() {
  const [aba, setAba] = useState<TipoTermo>("banca");
  const [termos, setTermos] = useState<Termo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aRenomear, setARenomear] = useState<Termo | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [erroRenomear, setErroRenomear] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<Termo | null>(null);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const avisar = useToast();
  // Descarta respostas fora de ordem: trocar de aba rápido (Banca → Assunto →
  // Cargo) pode fazer a resposta de uma aba antiga chegar depois da atual, e
  // sem isto ela sobrescreveria a tela com os termos da aba errada.
  const idRequisicao = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++idRequisicao.current;
    setCarregando(true);
    setErroCarregamento(null);
    try {
      const dados = await api.termos(aba);
      if (id !== idRequisicao.current) return;
      setTermos(dados);
    } catch (falha) {
      if (id !== idRequisicao.current) return;
      setErroCarregamento(mensagemDe(falha));
      setTermos([]);
    } finally {
      if (id === idRequisicao.current) setCarregando(false);
    }
  }, [aba]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function adicionar(evento: React.FormEvent) {
    evento.preventDefault();
    // O `required` do HTML dava duas coisas erradas: o balão nativo do
    // navegador, fora do padrão de erro do painel, e " " contado como
    // preenchido. A regra aqui é a mesma do servidor
    // (api/src/routes/admin/taxonomy.ts:21, `z.string().trim().min(1)`).
    const limpo = nome.trim();
    if (!limpo) {
      setErro("Informe o nome do termo.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await api.criarTermo(aba, limpo);
      setNome("");
      avisar("Termo criado.");
      await carregar();
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function renomear() {
    if (!aRenomear) return;
    const alvo = aRenomear;
    // Mesma regra do formulário de cadastro, pelo mesmo motivo: o servidor
    // apara o nome antes de validar, então " " chegaria lá só para voltar
    // como erro genérico.
    const limpo = novoNome.trim();
    if (!limpo) {
      setErroRenomear("Informe o nome do termo.");
      return;
    }
    setErroRenomear(null);
    setRenomeando(true);
    try {
      await api.renomearTermo(alvo.id, limpo);
      setARenomear(null);
      avisar("Termo renomeado.");
      await carregar();
    } catch (falha) {
      // Inline, e não em toast: o toast fica acima do overlay e é fácil de
      // não notar com o modal ainda aberto na frente. O erro pertence ao
      // campo que o causou — é o mesmo tratamento que o cadastro dá ao 409.
      setErroRenomear(mensagemDe(falha));
    } finally {
      setRenomeando(false);
    }
  }

  async function excluir() {
    if (!aExcluir) return;
    const alvo = aExcluir;
    setErroExcluir(null);
    setExcluindo(true);
    try {
      await api.excluirTermo(alvo.id);
      setAExcluir(null);
      avisar("Termo excluído.");
      await carregar();
    } catch (falha) {
      // Dentro do diálogo, e não em toast: o modal continua aberto no caminho
      // de falha, então a mensagem precisa estar onde os olhos já estão.
      setErroExcluir(mensagemDe(falha));
    } finally {
      setExcluindo(false);
    }
  }

  const colunas: Coluna<Termo>[] = [
    { titulo: "Nome", principal: true, celula: (t) => t.name },
    {
      titulo: "Ações",
      celula: (t) => (
        <div className="flex gap-2">
          <BotaoIcone
            rotulo={`Renomear ${t.name}`}
            icone={<IconeEditar />}
            onClick={() => {
              setARenomear(t);
              setNovoNome(t.name);
              setErroRenomear(null);
            }}
          />
          <BotaoIcone
            variante="perigo"
            rotulo={`Excluir ${t.name}`}
            icone={<IconeExcluir />}
            onClick={() => {
              setAExcluir(t);
              setErroExcluir(null);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <h1 className="font-display text-2xl font-bold mb-5">Taxonomias</h1>

      <div role="tablist" className="flex gap-2 mb-5 flex-wrap">
        {ABAS.map((item) => (
          <button
            key={item.kind}
            role="tab"
            aria-selected={aba === item.kind}
            onClick={() => {
              setAba(item.kind);
              setErro(null);
              setNome("");
            }}
            className={`px-4 h-11 rounded-btn border text-[14.5px] font-semibold transition-colors inline-flex items-center gap-2 ${
              aba === item.kind
                ? "border-roxo bg-roxo-bg text-roxo"
                : "border-borda-2 bg-card text-txt hover:border-borda-3"
            }`}
          >
            <item.Icone />
            {item.rotulo}
          </button>
        ))}
      </div>

      <Card className="p-4 md:p-5 mb-5">
        <form onSubmit={adicionar} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Campo rotulo="Nome" htmlFor="novo-termo" erro={erro ?? undefined}>
              <input
                id="novo-termo"
                className={`${CONTROLE} ${erro ? CONTROLE_INVALIDO : ""}`}
                aria-invalid={erro ? true : undefined}
                value={nome}
                maxLength={120}
                onChange={(e) => {
                  setNome(e.target.value);
                  if (erro) setErro(null);
                }}
              />
            </Campo>
          </div>
          <Botao type="submit" carregando={salvando}>
            <IconeAdicionar />
            Adicionar
          </Botao>
        </form>
      </Card>

      <Card>
        {carregando && <p className="p-8 text-center text-txt-2">Carregando…</p>}
        {!carregando && erroCarregamento && (
          <p role="alert" className="p-8 text-center font-semibold text-erro">
            {erroCarregamento}
          </p>
        )}
        {!carregando && !erroCarregamento && (
          <Tabela
            colunas={colunas}
            linhas={termos}
            chave={(t) => t.id}
            vazio="Nenhum termo cadastrado neste tipo."
          />
        )}
      </Card>

      <Modal
        aberto={aRenomear !== null}
        titulo="Renomear termo"
        rotuloConfirmar="Salvar"
        iconeConfirmar={<IconeSalvar />}
        carregando={renomeando}
        aoConfirmar={() => void renomear()}
        aoCancelar={() => {
          setARenomear(null);
          setErroRenomear(null);
        }}
      >
        <Campo
          rotulo="Novo nome"
          htmlFor="novo-nome"
          erro={erroRenomear ?? undefined}
        >
          <input
            id="novo-nome"
            className={`${CONTROLE} ${erroRenomear ? CONTROLE_INVALIDO : ""}`}
            aria-invalid={erroRenomear ? true : undefined}
            value={novoNome}
            maxLength={120}
            onChange={(e) => {
              setNovoNome(e.target.value);
              if (erroRenomear) setErroRenomear(null);
            }}
          />
        </Campo>
      </Modal>

      <Modal
        aberto={aExcluir !== null}
        titulo="Excluir termo?"
        perigo
        rotuloConfirmar="Excluir"
        iconeConfirmar={<IconeExcluir />}
        carregando={excluindo}
        erro={erroExcluir ?? undefined}
        aoConfirmar={() => void excluir()}
        aoCancelar={() => {
          setAExcluir(null);
          setErroExcluir(null);
        }}
      >
        O termo some das listas de escolha, mas as questões já cadastradas
        continuam exibindo o nome dele.
      </Modal>
    </Layout>
  );
}
