import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { ProvedorToast } from "@mais/ui";
import "./globals.css";

// next/font baixa e auto-hospeda no build: nenhuma requisição a servidor de
// fonte em runtime, e nenhum pacote npm novo (vem dentro do próprio next).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--fonte-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--fonte-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Painel — Mais Aprovação Questões",
  // Defesa em profundidade: o Access já devolve a tela do IdP ao crawler.
  // A camada robusta é o X-Robots-Tag em public/_headers; esta é a segunda.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${poppins.variable}`}>
      <body>
        <ProvedorToast>{children}</ProvedorToast>
      </body>
    </html>
  );
}
