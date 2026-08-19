import type { ReactNode } from "react";

/**
 * Só o rótulo, a mensagem de erro e o espaçamento. O controle vem por
 * `children` de propósito: input, select e textarea têm APIs diferentes
 * demais para caberem numa prop `tipo` sem virar um componente que faz três
 * coisas.
 */
export function Campo({
  rotulo,
  erro,
  aviso,
  dica,
  htmlFor,
  children,
}: {
  rotulo: string;
  erro?: string;
  /**
   * Mesma aparência do `erro` e etiqueta ARIA diferente: `role="status"` é
   * polido — entra na fila do leitor de tela em vez de interromper o que
   * está sendo falado.
   *
   * Para o aviso que aparece enquanto a pessoa digita, e que ela não pediu.
   * Um erro que responde a uma ação disparada continua sendo `erro`.
   */
  aviso?: string;
  dica?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-txt">
        {rotulo}
      </label>
      {children}
      {dica && !erro && !aviso && (
        <p className="text-[12.5px] text-txt-3">{dica}</p>
      )}
      {aviso && !erro && (
        <p role="status" className="text-[12.5px] font-semibold text-erro">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-[12.5px] font-semibold text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Estilo compartilhado por input, select e textarea. */
export const CONTROLE =
  "w-full h-[50px] px-3.5 rounded-btn border border-borda-2 bg-white " +
  "text-[14.5px] text-txt outline-none transition-colors " +
  "hover:border-borda-3 focus:border-roxo";

/**
 * Aplicado junto do CONTROLE quando o campo tem erro.
 *
 * Não vence por vir depois: `hover:border-borda-3` tem especificidade maior
 * (0,2,0 contra 0,1,0 de `border-erro`) e ganha de qualquer forma, e
 * `focus:border-roxo` é gerado depois de `focus:border-erro`, então venceria
 * por ordem. As três variantes levam o modificador `!` do Tailwind v4 para
 * forçar `!important` e garantir que o erro sempre apareça, em repouso, no
 * hover e no foco.
 */
export const CONTROLE_INVALIDO = "border-erro! hover:border-erro! focus:border-erro!";
