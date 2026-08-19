"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Botao } from "@mais/ui";
import { api } from "@/lib/api";
import { FALHA_DE_REDE } from "@/lib/erros";
import { useSessao } from "@/lib/sessao";

const NAV = [
  { href: "/", rotulo: "Questões" },
  { href: "/taxonomias", rotulo: "Taxonomias" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { carregando, admin, falhaDeRede } = useSessao();
  const caminho = usePathname();
  const router = useRouter();

  if (carregando) {
    return <main className="p-8 text-txt-2">Carregando…</main>;
  }
  // A recarga é pedida, não automática (spec §9): o painel nunca navega
  // sozinho. Aqui ele diz o que houve e espera a pessoa decidir.
  if (falhaDeRede) {
    return (
      <main className="p-8">
        <p role="alert" className="text-[13.5px] font-semibold text-erro">
          {FALHA_DE_REDE}
        </p>
      </main>
    );
  }
  if (!admin) return null; // useSessao já redirecionou

  async function sair() {
    await api.sair().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <>
      <header className="bg-card border-b border-borda">
        {/*
          flex-wrap em vez de espremer gap: abaixo de md o <nav> (w-full,
          order-3) quebra pra linha própria, então a largura da tela nunca
          decide se cabe — cabe sempre, por construção, em vez de depender de
          uma soma de larguras específicas caber num viewport específico.
          order-* só muda a posição visual, não a ordem do DOM, então a ordem
          de tab (Logo → Questões → Taxonomias → Sair) não muda em nenhum
          tamanho de tela.
        */}
        <div className="max-w-[1320px] mx-auto px-4 md:px-6 flex flex-wrap items-center gap-x-4 gap-y-3 py-3 md:py-0 md:h-[84px]">
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
          <nav className="order-3 md:order-none w-full md:w-auto flex items-center gap-5 md:gap-8">
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
          <div className="order-2 md:order-none ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-[15px] font-semibold">
              {admin.email}
            </span>
            <Link
              href="/senha"
              className="hidden sm:inline text-[15px] font-semibold text-txt-2"
            >
              Trocar senha
            </Link>
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
