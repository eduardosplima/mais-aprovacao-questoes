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
  dica,
  htmlFor,
  children,
}: {
  rotulo: string;
  erro?: string;
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
      {dica && !erro && <p className="text-[12.5px] text-txt-3">{dica}</p>}
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

/** Aplicado junto do CONTROLE quando o campo tem erro. Vence por vir depois. */
export const CONTROLE_INVALIDO = "border-erro focus:border-erro";
