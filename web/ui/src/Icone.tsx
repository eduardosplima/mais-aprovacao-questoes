import type { ReactNode } from "react";

/**
 * Traço único, herdado do docs/demo.html: contorno de 2px, pontas
 * arredondadas, sem preenchimento. Cor e tamanho vêm do contexto via
 * currentColor e className.
 *
 * aria-hidden é obrigatório: sem ele o conteúdo do SVG entra no nome
 * acessível do botão que o contém e quebra os seletores dos e2e.
 */
function Svg({
  className = "w-[18px] h-[18px]",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type PropsIcone = { className?: string };

/** Assinatura comum a todos os componentes de ícone deste arquivo. */
export type ComponenteIcone = (props: PropsIcone) => React.JSX.Element;

// ---- taxonomias e campos de escolha (docs/demo.html) ----

export function IconeAssunto(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  );
}

export function IconeBanca(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </Svg>
  );
}

export function IconeAno(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  );
}

export function IconeCargo(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Svg>
  );
}

export function IconeNivel(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </Svg>
  );
}

export function IconeSituacao(p: PropsIcone) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}

export function IconeTipo(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </Svg>
  );
}

/**
 * A seta do `<select>`. Existe porque `appearance-none` apaga a nativa, e
 * `appearance-none` existe porque o Safari descarta o padding do autor
 * enquanto a aparência nativa valer. Não é enfeite: sem ela o campo não se
 * anuncia como lista.
 */
export function IconeSeta(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

/**
 * Setas de navegação de página. Separadas do `IconeSeta` (que é a do
 * `<select>`, e aponta para baixo) porque significam coisa diferente: aqui a
 * direção é o próprio conteúdo da ação, e é por isso que estes dois ficam do
 * lado para onde apontam em vez de antes do texto.
 */
export function IconeAnterior(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="15 18 9 12 15 6" />
    </Svg>
  );
}

export function IconeProxima(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}

// ---- ações ----

export function IconeEditar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </Svg>
  );
}

export function IconeExcluir(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}

export function IconePublicar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconeDespublicar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </Svg>
  );
}

export function IconePreview(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </Svg>
  );
}

export function IconeAdicionar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function IconeSalvar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </Svg>
  );
}

export function IconeCancelar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function IconeChave(p: PropsIcone) {
  return (
    <Svg {...p}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2" />
      <path d="M18 5l2 2" />
      <path d="M15 8l2 2" />
    </Svg>
  );
}

export function IconeEntrar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </Svg>
  );
}

export function IconeSair(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  );
}
