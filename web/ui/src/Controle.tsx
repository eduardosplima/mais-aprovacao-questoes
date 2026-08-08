import type { ReactNode } from "react";

/**
 * Sobrepõe um ícone à esquerda de um controle nativo.
 *
 * Um <select> não aceita elemento filho além de <option>, então não há como
 * pôr o SVG dentro dele. Manter o select nativo importa — navegação por
 * teclado e o seletor de roda do iOS —, então o ícone fica posicionado por
 * cima, com pointer-events desligado para não roubar o clique que abre a
 * lista. O controle recebe pl-11 para abrir o espaço.
 */
export function Controle({
  icone,
  children,
}: {
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-roxo pointer-events-none flex">
        {icone}
      </span>
      {children}
    </div>
  );
}
