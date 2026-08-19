"use client";

import { useState } from "react";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

/**
 * Atrás do Access (o hostname inteiro está), atrás da sessão do painel e
 * atrás da senha atual — três provas. A terceira é a que impede que uma
 * sessão deixada aberta numa máquina destravada vire sequestro da conta.
 *
 * Não existe recuperação por email para admin: quem esquece a senha pede uma
 * nova pelo CLI (`npm run admin:senha`).
 */
export default function PaginaSenha() {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setPronto(false);

    // Conferência local: mandar duas senhas para o servidor comparar seria
    // uma ida à rede para descobrir o que já dá para saber aqui.
    if (nova !== confirmacao) {
      setErro("A nova senha e a confirmação não conferem.");
      return;
    }

    setEnviando(true);
    try {
      await api.trocarSenha(atual, nova);
      setPronto(true);
      setAtual("");
      setNova("");
      setConfirmacao("");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Layout>
      <Card className="max-w-[480px] p-7 flex flex-col gap-5">
        <h1 className="font-display text-xl font-bold">Trocar senha</h1>

        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo rotulo="Senha atual" htmlFor="atual">
            <input
              id="atual"
              type="password"
              autoComplete="current-password"
              required
              className={CONTROLE}
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Nova senha" htmlFor="nova">
            <input
              id="nova"
              type="password"
              autoComplete="new-password"
              required
              className={CONTROLE}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Confirme a nova senha" htmlFor="confirmacao">
            <input
              id="confirmacao"
              type="password"
              autoComplete="new-password"
              required
              className={CONTROLE}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </Campo>

          {erro && (
            <p role="alert" className="text-[13.5px] font-semibold text-erro">
              {erro}
            </p>
          )}
          {pronto && (
            <p role="status" className="text-[13.5px] font-semibold">
              Senha trocada.
            </p>
          )}

          <Botao type="submit" carregando={enviando}>
            Trocar senha
          </Botao>
        </form>
      </Card>
    </Layout>
  );
}
