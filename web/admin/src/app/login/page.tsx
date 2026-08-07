"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

export default function PaginaLogin() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
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
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
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

            <div ref={widget} />

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
    </>
  );
}
