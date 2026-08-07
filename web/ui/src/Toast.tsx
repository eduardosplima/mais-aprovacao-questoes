"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tom = "ok" | "erro";
type Avisar = (texto: string, tom?: Tom) => void;

const Ctx = createContext<Avisar | null>(null);

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<{ texto: string; tom: Tom } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback<Avisar>((texto, tom = "ok") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAviso({ texto, tom });
    timerRef.current = setTimeout(() => setAviso(null), 4000);
  }, []);

  // Limpa o timer pendente se o provedor desmontar antes dos 4s — evita
  // chamar setAviso depois que o componente já saiu de cena.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const valor = useMemo(() => avisar, [avisar]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      {aviso && (
        <div
          role="status"
          className={`fixed left-1/2 bottom-6 -translate-x-1/2 z-50 px-5 py-3 rounded-btn text-white text-sm font-semibold shadow-card-2 ${
            aviso.tom === "erro" ? "bg-erro" : "bg-txt"
          }`}
        >
          {aviso.texto}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): Avisar {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast fora do ProvedorToast");
  return ctx;
}
