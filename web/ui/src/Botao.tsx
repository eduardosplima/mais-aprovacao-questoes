import type { ButtonHTMLAttributes, ReactNode } from "react";

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

const BASE_ICONE =
  "inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-btn " +
  "transition-[background,transform,box-shadow] active:translate-y-px " +
  "disabled:opacity-55 disabled:cursor-not-allowed";

/**
 * As classes do botão-ícone, expostas para quem precisa aplicá-las a um
 * elemento que este pacote não pode construir — o caso concreto é o Link do
 * Next, que vive no `admin` porque `web/ui` não importa `next` (é o que o
 * mantém consumível pelo sub-projeto 4).
 */
export function classesBotaoIcone(
  variante: VarianteBotao = "secundario",
): string {
  return `${BASE_ICONE} ${VARIANTE[variante]}`;
}

/**
 * Ação representada só por ícone. O `rotulo` vira as duas coisas ao mesmo
 * tempo: `title` (o tooltip visível) e `aria-label` (o nome acessível, que é
 * o que leitor de tela e Playwright leem).
 *
 * O tamanho é fixo de propósito. O defeito que isto corrige era o `Botao`
 * normal ter altura no BASE e as chamadas a encolherem por className — dois
 * utilitários de altura na mesma classe, onde quem vence é a ordem de geração
 * do CSS e não a ordem da string. Era a causa do "Editar" desalinhado.
 */
export function BotaoIcone({
  icone,
  rotulo,
  variante = "secundario",
  className = "",
  ...resto
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icone: ReactNode;
  rotulo: string;
  variante?: VarianteBotao;
}) {
  return (
    <button
      {...resto}
      type="button"
      title={rotulo}
      aria-label={rotulo}
      className={`${classesBotaoIcone(variante)} ${className}`}
    >
      {icone}
    </button>
  );
}
