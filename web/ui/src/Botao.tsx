import type { ButtonHTMLAttributes } from "react";

export type VarianteBotao = "primario" | "secundario" | "perigo";

const BASE =
  "inline-flex items-center justify-center gap-2 h-[46px] px-5 rounded-btn " +
  "font-bold text-[14.5px] transition-[background,transform,box-shadow] " +
  "disabled:opacity-55 disabled:cursor-not-allowed disabled:shadow-none " +
  "active:translate-y-px";

const VARIANTE: Record<VarianteBotao, string> = {
  primario: "bg-roxo text-white shadow-btn hover:bg-roxo-2",
  secundario: "bg-card text-txt border border-borda-2 hover:border-borda-3 hover:bg-roxo-bg/40",
  perigo: "bg-erro text-white hover:brightness-95",
};

export function Botao({
  variante = "primario",
  carregando = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao;
  carregando?: boolean;
}) {
  return (
    <button
      {...resto}
      type={type}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={`${BASE} ${VARIANTE[variante]} ${className}`}
    >
      {carregando ? "Aguarde…" : children}
    </button>
  );
}
