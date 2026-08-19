"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { api, type ContextoAdmin } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

/**
 * Três estados, decididos pelo servidor. Não há campo de email: a identidade
 * vem do token do Access e o Worker a lê de lá, então oferecer onde digitar
 * outro seria oferecer um controle que não controla nada.
 *
 * Sem Turnstile, ao contrário do login do aluno: esta tela só é alcançável
 * atrás do Access, que exige login no IdP com MFA — não há bot anônimo a
 * barrar (spec §6).
 */
export default function PaginaLogin() {
  const [contexto, setContexto] = useState<ContextoAdmin | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    api
      .contexto()
      .then((c) => {
        if (vivo) setContexto(c);
      })
      .catch((falha) => {
        if (vivo) setErro(mensagemDe(falha));
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.entrar(senha);
      router.replace("/");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  const pronto = contexto?.ehAdmin && contexto.temSenha;

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <Card className="w-full max-w-[420px] p-7 flex flex-col gap-5">
        <Image
          src="/logo.png"
          alt="Mais Aprovação Questões"
          width={200}
          height={76}
          className="h-14 w-auto self-center"
          priority
        />
        <h1 className="font-display text-xl font-bold text-center">
          Painel administrativo
        </h1>

        {contexto && (
          <p className="text-[13.5px] text-txt-2 text-center">
            Você entrou pelo Access como <strong>{contexto.email}</strong>.
          </p>
        )}

        {contexto && !contexto.ehAdmin && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            Este email não é administrador.
          </p>
        )}

        {contexto?.ehAdmin && !contexto.temSenha && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            Este email ainda não tem senha definida. Entre em contato com o time
            de desenvolvimento.
          </p>
        )}

        {pronto && (
          <form onSubmit={enviar} className="flex flex-col gap-4">
            <Campo rotulo="Senha" htmlFor="senha">
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                className={CONTROLE}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>

            {erro && (
              <p role="alert" className="text-[13.5px] font-semibold text-erro">
                {erro}
              </p>
            )}

            <Botao type="submit" carregando={enviando}>
              Entrar
            </Botao>
          </form>
        )}

        {/* Sair do painel não sai do Access — são sessões diferentes. */}
        <a
          href="/cdn-cgi/access/logout"
          className="text-[12.5px] text-txt-3 text-center"
        >
          Encerrar também a sessão do Access
        </a>
      </Card>
    </main>
  );
}
