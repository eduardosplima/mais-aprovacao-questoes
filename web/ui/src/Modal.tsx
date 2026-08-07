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
    // Cancelar é o primeiro botão do diálogo — a opção segura e não
    // destrutiva para receber o foco inicial.
    dialogoRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

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
