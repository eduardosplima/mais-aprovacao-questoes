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
  falhaDeRede: boolean;
} {
  const [admin, setAdmin] = useState<{ email: string } | null>(null);
  const [falhaDeRede, setFalhaDeRede] = useState(false);
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
        // Falha de rede não desloga: expulsar por um blip é pior que ficar.
        // Mas ficar precisa mostrar alguma coisa — devolver `null` daqui e
        // `null` do Layout deixava a pessoa numa tela em branco, sem próxima
        // ação nenhuma. Quem distingue este caso do 401/403 acima é esta
        // bandeira; o Layout usa ela para exibir a orientação.
        setFalhaDeRede(true);
        setAdmin(null);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [router]);

  return { carregando, admin, falhaDeRede };
}
