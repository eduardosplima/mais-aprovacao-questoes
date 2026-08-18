import type { ReactNode } from "react";
import { IconeSeta } from "./Icone";

/**
 * Sobrepõe um ícone à esquerda de um controle nativo, e opcionalmente uma
 * seta à direita.
 *
 * Um <select> não aceita elemento filho além de <option>, então não há como
 * pôr o SVG dentro dele. Manter o select nativo importa — navegação por
 * teclado e o seletor de roda do iOS —, então o ícone fica posicionado por
 * cima, com pointer-events desligado para não roubar o clique que abre a
 * lista. O controle recebe pl-11 para abrir o espaço.
 *
 * `seta` só é ligada em <select>, e sempre junto de `appearance-none` e
 * `pr-11` no controle. As duas coisas andam juntas: `appearance-none` é o que
 * faz o Safari voltar a honrar o padding do autor, e apagar a seta nativa é o
 * preço dela. Um <input> nunca leva `seta` — ele não é uma lista.
 */
export function Controle({
  icone,
  seta = false,
  children,
}: {
  icone: ReactNode;
  seta?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-roxo pointer-events-none flex">
        {icone}
      </span>
      {children}
      {seta && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-txt-3 pointer-events-none flex">
          <IconeSeta />
        </span>
      )}
    </div>
  );
}
