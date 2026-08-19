"use client";

import { useRef, useState } from "react";
import {
  Campo,
  CONTROLE,
  CONTROLE_INVALIDO,
  IconeSalvar,
  Modal,
  useToast,
} from "@mais/ui";
import { api, ApiError } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const ID_FORM = "form-trocar-senha";

type Erros = {
  atual?: string;
  nova?: string;
  confirmacao?: string;
  geral?: string;
};

/**
 * Atrás do Access (o hostname inteiro está), atrás da sessão do painel e
 * atrás da senha atual — três provas. A terceira é a que impede que uma
 * sessão deixada aberta numa máquina destravada vire sequestro da conta.
 *
 * Não existe recuperação por email para admin: quem esquece a senha pede uma
 * nova pelo CLI (`npm run admin:senha`).
 *
 * É modal, e não rota própria, porque trocar senha não é um lugar aonde se
 * vai: é uma coisa que se faz sem sair de onde se está. Sem navegação não há
 * "voltar para a tela anterior" a resolver, e o sucesso pode ser o mesmo
 * toast que o resto do painel usa.
 */
export function ModalTrocarSenha({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);
  const avisar = useToast();
  // Cancelar não cancela a requisição que já saiu, e um booleano único não
  // basta: cancelar A e reenviar (B) antes de A responder faria o `catch`
  // de A ver B como "não descartado" e escrever erro velho por cima do
  // estado de B, além de destravar o botão com B ainda em voo. O contador
  // dá identidade a cada requisição — mesmo mecanismo de
  // app/taxonomias/page.tsx e app/page.tsx.
  const idRequisicao = useRef(0);
  // O erro de "Nova senha" tem duas origens: validação local (some ao digitar,
  // porque digitar é o que a corrige) e recusa do servidor, que enuncia a
  // regra a cumprir — essa precisa ficar na tela enquanto a pessoa tenta
  // cumpri-la, e só sai no envio seguinte.
  const novaDoServidor = useRef(false);

  // O tip ao vivo (spec §4): com os dois preenchidos e diferentes, a
  // divergência aparece enquanto se digita. Os dois campos são type=password,
  // então a pessoa não tem como conferir a olho o que digitou — descobrir só
  // no envio é descobrir tarde.
  const divergem =
    nova !== "" && confirmacao !== "" && nova !== confirmacao;

  function fechar() {
    // Invalida qualquer requisição em voo: a resposta que chegar depois já
    // não bate mais com idRequisicao.current, então cai nos `return` do
    // catch/finally abaixo em vez de reescrever o estado que este fechar()
    // acabou de limpar.
    idRequisicao.current++;
    setAtual("");
    setNova("");
    setConfirmacao("");
    setErros({});
    // fechar() acontece tanto pelo Cancelar quanto pelo sucesso do envio, e
    // o finally de enviar() não mexe em enviando quando o id não bate mais —
    // sem isto aqui, o botão ficava preso em "Aguarde…" na reabertura.
    setEnviando(false);
    aoFechar();
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    // Conferência local: mandar duas senhas para o servidor comparar seria
    // uma ida à rede para descobrir o que já dá para saber aqui.
    const encontrados: Erros = {};
    if (!atual) encontrados.atual = "Informe a senha atual.";
    if (!nova) encontrados.nova = "Informe a nova senha.";
    if (!confirmacao) encontrados.confirmacao = "Confirme a nova senha.";
    // `nova &&` porque com ela vazia a divergência é consequência, não causa:
    // o campo que precisa de conteúdo é o de cima, e é dele que a pessoa
    // precisa ouvir.
    else if (nova && nova !== confirmacao) {
      encontrados.confirmacao = "A confirmação não confere.";
    }
    if (Object.keys(encontrados).length > 0) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setEnviando(true);
    const id = ++idRequisicao.current;
    novaDoServidor.current = false;
    try {
      await api.trocarSenha(atual, nova);
      if (id !== idRequisicao.current) return;
      avisar("Senha trocada.");
      fechar();
    } catch (falha) {
      if (id !== idRequisicao.current) return;
      // O erro pertence ao campo que o causou — mesmo tratamento que o 409 de
      // taxonomia recebe. Cair tudo numa linha genérica obrigaria o operador
      // a adivinhar qual dos três campos está errado.
      if (falha instanceof ApiError && falha.codigo === "senha_atual_incorreta") {
        setErros({ atual: mensagemDe(falha) });
      } else if (falha instanceof ApiError && falha.codigo === "weak_password") {
        novaDoServidor.current = true;
        setErros({ nova: mensagemDe(falha) });
      } else {
        setErros({ geral: mensagemDe(falha) });
      }
    } finally {
      if (id === idRequisicao.current) setEnviando(false);
    }
  }

  // O erro de envio e o tip ao vivo têm a mesma frase e papéis diferentes: o
  // primeiro responde a uma ação e interrompe; o segundo aparece sozinho e
  // espera a vez.
  const avisoDivergencia =
    !erros.confirmacao && divergem ? "A confirmação não confere." : undefined;
  // O campo está de fato inválido nos dois casos — o aria-invalid e a borda
  // vermelha não distinguem, só a etiqueta do texto distingue.
  const confirmacaoInvalida = Boolean(erros.confirmacao) || divergem;

  // O erro geral não pertence a nenhum campo, então nenhum `onChange` o
  // limpava — e ele ficava na tela enquanto a pessoa reescrevia tudo.
  function limparGeral() {
    setErros((x) => (x.geral ? { ...x, geral: undefined } : x));
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Trocar senha"
      rotuloConfirmar="Salvar"
      iconeConfirmar={<IconeSalvar />}
      carregando={enviando}
      idFormulario={ID_FORM}
      aoConfirmar={() => undefined}
      aoCancelar={fechar}
      erro={erros.geral}
    >
      <form id={ID_FORM} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Campo rotulo="Senha atual" htmlFor="atual" erro={erros.atual}>
          <input
            id="atual"
            type="password"
            autoComplete="current-password"
            aria-required
            aria-invalid={erros.atual ? true : undefined}
            className={`${CONTROLE} ${erros.atual ? CONTROLE_INVALIDO : ""}`}
            value={atual}
            onChange={(e) => {
              setAtual(e.target.value);
              limparGeral();
              if (erros.atual) setErros((x) => ({ ...x, atual: undefined }));
            }}
          />
        </Campo>
        <Campo rotulo="Nova senha" htmlFor="nova" erro={erros.nova}>
          <input
            id="nova"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={erros.nova ? true : undefined}
            className={`${CONTROLE} ${erros.nova ? CONTROLE_INVALIDO : ""}`}
            value={nova}
            onChange={(e) => {
              setNova(e.target.value);
              limparGeral();
              if (erros.nova && !novaDoServidor.current) {
                setErros((x) => ({ ...x, nova: undefined }));
              }
              // erros.confirmacao tem duas causas possíveis (mais abaixo, na
              // validação local): campo vazio ou divergência. Só a segunda é
              // resolvida por aqui — se "Confirme a nova senha" continua
              // vazio, editar a Nova senha não corrigiu nada, e a mensagem
              // "Confirme a nova senha." precisa ficar. Quando há conteúdo,
              // o erro só pode ser de divergência, e limpar aqui é o que faz
              // o Enter (I1) funcionar: sem isso a mensagem ficava presa num
              // campo que a pessoa acabou de corrigir pelo lado da Nova
              // senha.
              if (erros.confirmacao && confirmacao !== "") {
                setErros((x) => ({ ...x, confirmacao: undefined }));
              }
            }}
          />
        </Campo>
        <Campo
          rotulo="Confirme a nova senha"
          htmlFor="confirmacao"
          erro={erros.confirmacao}
          aviso={avisoDivergencia}
        >
          <input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={confirmacaoInvalida ? true : undefined}
            className={`${CONTROLE} ${confirmacaoInvalida ? CONTROLE_INVALIDO : ""}`}
            value={confirmacao}
            onChange={(e) => {
              setConfirmacao(e.target.value);
              limparGeral();
              if (erros.confirmacao) {
                setErros((x) => ({ ...x, confirmacao: undefined }));
              }
            }}
          />
        </Campo>
      </form>
    </Modal>
  );
}
