"use client";

import { useRef, useState } from "react";
import { useToast } from "@mais/ui";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

// Espelha api/src/routes/admin/media.ts:7 e lib/magicBytes.ts:9. O servidor
// verifica pelos magic bytes e é ele quem decide — isto aqui é só para não
// gastar upload de 5 MB antes de tomar 413.
const MAX_BYTES = 2 * 1024 * 1024;
const ACEITOS = "image/png,image/jpeg,image/webp,image/gif";

export function UploadImagem({ aoEnviar }: { aoEnviar: (url: string) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const avisar = useToast();

  async function escolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    // Limpa já: escolher o mesmo arquivo duas vezes seguidas não dispara
    // change se o valor continuar lá.
    evento.target.value = "";
    if (!arquivo) return;

    if (arquivo.size > MAX_BYTES) {
      avisar("Imagem acima de 2 MB. Reduza antes de enviar.", "erro");
      return;
    }

    setEnviando(true);
    try {
      aoEnviar(await api.enviarImagem(arquivo));
      avisar("Imagem enviada.");
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title="Inserir imagem"
        aria-label="Inserir imagem"
        disabled={enviando}
        onClick={() => entrada.current?.click()}
        className="h-9 min-w-9 px-2 rounded-lg text-[13px] font-bold text-txt-2 hover:bg-roxo-bg/50 disabled:opacity-50"
      >
        {enviando ? "…" : "🖼"}
      </button>
      <input
        ref={entrada}
        type="file"
        accept={ACEITOS}
        hidden
        onChange={(e) => void escolher(e)}
      />
    </>
  );
}
