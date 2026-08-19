"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Botao } from "./Botao";
import { IconeCancelar } from "./Icone";

export function Modal({
  aberto,
  titulo,
  children,
  aoConfirmar,
  aoCancelar,
  rotuloConfirmar = "Confirmar",
  perigo = false,
  iconeConfirmar,
  carregando = false,
  erro,
  idFormulario,
}: {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  rotuloConfirmar?: string;
  perigo?: boolean;
  /**
   * Ícone do botão de confirmar. Vem do chamador porque `Excluir` e `Salvar`
   * não são a mesma ação e não podem levar o mesmo ícone. O `Cancelar` não
   * tem prop equivalente: cancelar é sempre a mesma coisa, e oferecer a
   * escolha seria inventar uma decisão que não existe.
   *
   * Opcional, e não obrigatória, porque este pacote é consumido de fora: a
   * regra 2 do `web/README.md` é a autoridade sobre ícone em botão, e o tipo
   * não é o lugar de forçá-la.
   */
  iconeConfirmar?: ReactNode;
  /** Desabilita o confirmar e troca o texto por "Aguarde…" — a guarda de duplo clique. */
  carregando?: boolean;
  /**
   * Erro sem campo responsável, exibido dentro do próprio diálogo. Enquanto
   * há diálogo aberto o erro pertence a ele: toast fica na borda da tela,
   * acima do overlay, e é fácil de não ver com o modal na frente.
   *
   * Quando existe campo culpado — o 409 de renomear, por exemplo — o erro vai
   * no campo, não aqui.
   *
   * `role="alert"` é o papel certo aqui, e não contradiz o `aviso` do Campo:
   * isto é resposta a uma ação que a pessoa acabou de disparar e que falhou,
   * que é exatamente o caso de uso de um alerta assertivo.
   */
  erro?: string;
  /**
   * Id de um <form> renderizado dentro de `children`. Com ele o confirmar
   * vira o submit desse formulário, e Enter num campo envia — que é o que
   * qualquer pessoa espera de um formulário, e o que um <div> com botões
   * nunca fez.
   */
  idFormulario?: string;
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
        {erro && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            {erro}
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <Botao variante="secundario" onClick={aoCancelar}>
            <IconeCancelar />
            Cancelar
          </Botao>
          <Botao
            variante={perigo ? "perigo" : "primario"}
            carregando={carregando}
            type={idFormulario ? "submit" : "button"}
            form={idFormulario}
            onClick={idFormulario ? undefined : aoConfirmar}
          >
            {iconeConfirmar}
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}
