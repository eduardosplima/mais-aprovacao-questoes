"use client";

import { useState } from "react";
import { Campo, CONTROLE, CONTROLE_INVALIDO, Modal, useToast } from "@mais/ui";
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

  // O tip ao vivo (spec §4): com os dois preenchidos e diferentes, a
  // divergência aparece enquanto se digita. Os dois campos são type=password,
  // então a pessoa não tem como conferir a olho o que digitou — descobrir só
  // no envio é descobrir tarde.
  const divergem =
    nova !== "" && confirmacao !== "" && nova !== confirmacao;

  function fechar() {
    setAtual("");
    setNova("");
    setConfirmacao("");
    setErros({});
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
    else if (nova !== confirmacao) {
      encontrados.confirmacao = "A confirmação não confere.";
    }
    if (Object.keys(encontrados).length > 0) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setEnviando(true);
    try {
      await api.trocarSenha(atual, nova);
      avisar("Senha trocada.");
      fechar();
    } catch (falha) {
      // O erro pertence ao campo que o causou — mesmo tratamento que o 409 de
      // taxonomia recebe. Cair tudo numa linha genérica obrigaria o operador
      // a adivinhar qual dos três campos está errado.
      if (falha instanceof ApiError && falha.codigo === "senha_atual_incorreta") {
        setErros({ atual: mensagemDe(falha) });
      } else if (falha instanceof ApiError && falha.codigo === "weak_password") {
        setErros({ nova: mensagemDe(falha) });
      } else {
        setErros({ geral: mensagemDe(falha) });
      }
    } finally {
      setEnviando(false);
    }
  }

  const erroConfirmacao = erros.confirmacao ?? (divergem ? "A confirmação não confere." : undefined);

  return (
    <Modal
      aberto={aberto}
      titulo="Trocar senha"
      rotuloConfirmar="Salvar"
      carregando={enviando}
      idFormulario={ID_FORM}
      aoConfirmar={() => undefined}
      aoCancelar={fechar}
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
              if (erros.nova) setErros((x) => ({ ...x, nova: undefined }));
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
          erro={erroConfirmacao}
        >
          <input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={erroConfirmacao ? true : undefined}
            className={`${CONTROLE} ${erroConfirmacao ? CONTROLE_INVALIDO : ""}`}
            value={confirmacao}
            onChange={(e) => {
              setConfirmacao(e.target.value);
              if (erros.confirmacao) {
                setErros((x) => ({ ...x, confirmacao: undefined }));
              }
            }}
          />
        </Campo>
        {erros.geral && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            {erros.geral}
          </p>
        )}
      </form>
    </Modal>
  );
}
