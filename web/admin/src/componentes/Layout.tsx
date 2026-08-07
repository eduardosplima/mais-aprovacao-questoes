"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Botao } from "@mais/ui";
import { api } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

const NAV = [
  { href: "/", rotulo: "Questões" },
  { href: "/taxonomias", rotulo: "Taxonomias" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { carregando, usuario } = useSessao();
  const caminho = usePathname();
  const router = useRouter();

  if (carregando) {
    return <main className="p-8 text-txt-2">Carregando…</main>;
  }
  if (!usuario) return null; // useSessao já redirecionou

  async function sair() {
    await api.sair().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <>
      <header className="bg-card border-b border-borda">
        <div className="max-w-[1320px] mx-auto px-4 md:px-6 flex items-center gap-4 md:gap-6 h-[68px] md:h-[84px]">
          <Link href="/" className="shrink-0">
            <Image
              src="/logo.png"
              alt="Mais Aprovação Questões"
              width={180}
              height={68}
              className="h-10 md:h-[68px] w-auto"
              priority
            />
          </Link>
          <nav className="flex items-center gap-5 md:gap-8">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-[15px] font-semibold ${
                  caminho === item.href ? "text-roxo" : "text-txt-2"
                }`}
              >
                {item.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-[15px] font-semibold">
              {usuario.name ?? usuario.email}
            </span>
            <Botao variante="secundario" onClick={sair}>
              Sair
            </Botao>
          </div>
        </div>
      </header>
      <main className="max-w-[1320px] mx-auto px-4 md:px-6 py-6">{children}</main>
    </>
  );
}
