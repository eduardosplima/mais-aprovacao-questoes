"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";

/**
 * Guarda de rota do lado do cliente. Não é controle de acesso — o controle é
 * as cinco checagens de `requireSessaoAdmin`
 * (api/src/middleware/adminSession.ts) e o Cloudflare Access na borda. Isto
 * aqui só evita mostrar uma tela vazia a quem não tem sessão, e é por isso
 * que pode viver no navegador sem risco.
 */
export function useSessao(): {
  carregando: boolean;
  admin: { email: string } | null;
} {
  const [admin, setAdmin] = useState<{ email: string } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    api
      .me()
      .then((a) => {
        if (!vivo) return;
        setAdmin(a);
      })
      .catch((erro) => {
        if (!vivo) return;
        // Sem ?motivo=: a tela de login descobre sozinha o que dizer, pelo
        // /admin/auth/contexto.
        if (erro instanceof ApiError && (erro.status === 401 || erro.status === 403)) {
          router.replace("/login");
          return;
        }
        // Falha de rede não desloga: manter o usuário na tela e deixar a
        // próxima ação mostrar o erro é melhor que expulsar por um blip.
        setAdmin(null);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [router]);

  return { carregando, admin };
}
