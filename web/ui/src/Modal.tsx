"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Botao } from "./Botao";

export function Modal({
  aberto,
  titulo,
  children,
  aoConfirmar,
  aoCancelar,
  rotuloConfirmar = "Confirmar",
  perigo = false,
}: {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  rotuloConfirmar?: string;
  perigo?: boolean;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);
  // Guarda a versão mais recente de aoCancelar sem entrar nas deps do efeito
  // abaixo — assim ele não refaz o setup (e rouba o foco de novo) só porque
  // o chamador passou uma nova função inline num re-render.
  const aoCancelarRef = useRef(aoCancelar);
  aoCancelarRef.current = aoCancelar;

  useEffect(() => {
    if (!aberto) return;

    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    // Primeiro elemento focável do diálogo recebe o foco inicial. Como
    // `children` é renderizado antes da linha de botões, isso manda o foco
    // pro campo de formulário quando há um (ex.: o diálogo de renomear) e,
    // na ausência de um (children é só texto, ex.: o diálogo de excluir),
    // cai no Cancelar — o primeiro botão e a opção segura e não destrutiva.
    dialogoRef.current
      ?.querySelector<HTMLElement>("input, select, textarea, button, [href]")
      ?.focus();

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoCancelarRef.current();
    }
    document.addEventListener("keydown", aoTeclar);

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus();
    };
  }, [aberto]);

  if (!aberto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={aoCancelar}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card rounded-card shadow-card-2 p-6 flex flex-col gap-4"
      >
        <h2 className="font-display text-lg font-bold">{titulo}</h2>
        {children && <div className="text-[14.5px] text-txt-2">{children}</div>}
        <div className="flex gap-3 justify-end">
          <Botao variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante={perigo ? "perigo" : "primario"} onClick={aoConfirmar}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}
