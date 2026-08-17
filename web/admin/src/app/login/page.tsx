"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { api, ApiError } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
    };
  }
}

function Formulario() {
  const parametros = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  // useSessao manda pra cá com ?motivo=forbidden quando a sessão é válida mas
  // a conta não é admin — sem isto a pessoa cai num formulário limpo, entra
  // de novo com a mesma conta e é expulsa outra vez, sem entender por quê.
  const [erro, setErro] = useState<string | null>(() =>
    parametros.get("motivo") === "forbidden"
      ? mensagemDe(new ApiError(403, "forbidden"))
      : null,
  );
  const [enviando, setEnviando] = useState(false);
  const [token, setToken] = useState("");
  const widget = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // O widget é montado à mão porque o script do Turnstile é carregado de
  // forma assíncrona pelo <Script>: o auto-render pode correr antes do React
  // ter posto a div no DOM.
  useEffect(() => {
    const timer = setInterval(() => {
      if (window.turnstile && widget.current && !widget.current.dataset.pronto) {
        widget.current.dataset.pronto = "1";
        window.turnstile.render(widget.current, {
          sitekey: SITE_KEY,
          callback: setToken,
          // O padrão do Turnstile é `auto`, que segue o prefers-color-scheme
          // do sistema. O painel é claro e não tem tema escuro, então em quem
          // usa o macOS no escuro o widget aparecia escuro dentro de um card
          // branco. Fixar em `light` é o que casa com o resto da tela.
          theme: "light",
        });
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.entrar(email, senha, token);
      router.replace("/");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

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

        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo rotulo="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className={CONTROLE}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Campo>
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

          {/* O Turnstile injeta um widget de largura fixa (300px no tamanho
              padrão), e este contêiner é esticado pelo flex do formulário até
              a largura do Card. Sem centrar, o widget é o único elemento da
              coluna que nem preenche a linha nem fica no meio dela — encosta
              à esquerda e deixa uma folga morta à direita. */}
          <div ref={widget} className="flex justify-center" />

          {erro && (
            <p role="alert" className="text-[13.5px] font-semibold text-erro">
              {erro}
            </p>
          )}

          {/* Desabilitado até o Turnstile responder: o token chega de forma
              assíncrona (a Cloudflare resolve o desafio em segundo plano) e
              submeter antes disso manda turnstileToken vazio, que o Worker
              sempre rejeita com captcha_failed. O aviso abaixo dá causa
              visível ao botão morto — sem ele, alguém com o Turnstile
              bloqueado por rede ou bloqueador de anúncios não teria como
              saber por que "Entrar" não reage. */}
          <Botao type="submit" carregando={enviando} disabled={!token}>
            Entrar
          </Botao>
          {!token && (
            <p className="text-[12.5px] text-txt-3">
              Aguardando a verificação de segurança…
            </p>
          )}
        </form>
      </Card>
    </main>
  );
}

export default function PaginaLogin() {
  // useSearchParams exige Suspense no App Router.
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <Suspense fallback={<main className="min-h-dvh" />}>
        <Formulario />
      </Suspense>
    </>
  );
}
