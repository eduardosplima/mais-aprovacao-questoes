import type { NextConfig } from "next";

const producao = process.env.NODE_ENV === "production";

/**
 * Um hostname só para painel e API (spec §2), por duas vias diferentes:
 *
 * - Em produção, duas Worker Routes capturam `/admin/*` e `/auth/*` em
 *   `admin.<domínio>`; o Pages serve o resto. O painel chama caminho relativo
 *   e a chamada é literalmente same-origin — sem CORS e com o cookie do Access
 *   viajando junto.
 * - Em desenvolvimento nada passa pela borda da Cloudflare, então o `next dev`
 *   faz o mesmo recorte por proxy, para o `wrangler dev` em 8787. O cookie de
 *   sessão volta pelo proxy e o navegador o atribui a localhost:3000 — de novo
 *   same-origin, e o `credentials: "same-origin"` do cliente de API funciona
 *   igual nos dois ambientes.
 *
 * `output: 'export'` fica fora de dev porque desabilitaria justamente esses
 * rewrites. No build de produção ele volta, e é ele que mantém o adaptador
 * @opennextjs/cloudflare (+405 pacotes) fora do repositório.
 */
const nextConfig: NextConfig = {
  output: producao ? "export" : undefined,
  // Sem servidor não há otimizador de imagem; sem isto o `next build` falha.
  images: { unoptimized: true },
  transpilePackages: ["@mais/ui"],
  async rewrites() {
    if (producao) return [];
    const worker = "http://127.0.0.1:8787";
    return {
      // `beforeFiles` corre antes do roteamento de páginas — sem isso o App
      // Router tentaria resolver /admin/* como rota do painel e devolveria 404.
      beforeFiles: [
        { source: "/admin/:path*", destination: `${worker}/admin/:path*` },
        { source: "/auth/:path*", destination: `${worker}/auth/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
