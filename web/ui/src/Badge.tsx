import type { ReactNode } from "react";

const TOM = {
  neutro: "bg-[#f1f1f4] text-txt-2",
  roxo: "bg-roxo-bg text-roxo",
  ok: "bg-ok-bg text-ok",
  erro: "bg-erro-bg text-erro",
} as const;

export function Badge({
  tom = "neutro",
  children,
}: {
  tom?: keyof typeof TOM;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block px-3 py-1.5 rounded-[9px] text-[13px] font-bold whitespace-nowrap ${TOM[tom]}`}
    >
      {children}
    </span>
  );
}
