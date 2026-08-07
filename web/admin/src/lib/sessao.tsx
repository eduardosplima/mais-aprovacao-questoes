"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Usuario } from "./api";

/**
 * Guarda de rota do lado do cliente. Não é controle de acesso — o controle é
 * o `role=admin` lido do D1 pelo Worker (api/src/middleware/rbac.ts) e o
 * Cloudflare Access na borda. Isto aqui só evita mostrar uma tela vazia a
 * quem não tem sessão, e é por isso que pode viver no navegador sem risco.
 */
export function useSessao(): { carregando: boolean; usuario: Usuario | null } {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    api
      .me()
      .then((u) => {
        if (!vivo) return;
        if (u.role !== "admin") {
          router.replace("/login?motivo=forbidden");
          return;
        }
        setUsuario(u);
      })
      .catch((erro) => {
        if (!vivo) return;
        if (erro instanceof ApiError && (erro.status === 401 || erro.status === 403)) {
          router.replace("/login");
          return;
        }
        // Falha de rede não desloga: manter o usuário na tela e deixar a
        // próxima ação mostrar o erro é melhor que expulsar por um blip.
        setUsuario(null);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [router]);

  return { carregando, usuario };
}
