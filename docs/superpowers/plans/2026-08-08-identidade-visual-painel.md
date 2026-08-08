# Identidade visual do painel — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar o painel administrativo ao `docs/demo.html` (ícones nas combos, abas e botões), trocar as ações de linha por ícones com tooltip, e indicar por campo o que impede a questão de salvar.

**Architecture:** Todo o trabalho fica em `web/`. O design system (`web/ui`) ganha três peças — o conjunto de ícones, o botão-ícone e o envelope que sobrepõe ícone a um controle nativo — e o painel (`web/admin`) passa a consumi-las. A API não é tocada: a validação por campo passa a existir no cliente, antes do envio.

**Tech Stack:** Next.js 16 (App Router, `output: 'export'`), React 19, Tailwind v4, TypeScript 5.9, Playwright 1.61.

## Global Constraints

- **Nenhum pacote novo.** Política do `~/.claude/CLAUDE.md` §5. Os ícones são SVG inline escritos à mão. Não instalar biblioteca de ícones nem de tooltip.
- **A API não muda.** Nada em `api/` é editado. Os 324 testes de `api/` não são executados nem alterados por este plano.
- **Traço dos ícones:** `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`. Herdam cor e tamanho do contexto.
- **Todo ícone decorativo leva `aria-hidden="true"`.** Sem isso o conteúdo do SVG entra no nome acessível e quebra seletores como `getByRole("tab", { name: "Cargo" })`.
- **Nome acessível preservado.** Um botão que vira ícone recebe `aria-label` **idêntico** ao texto que exibia antes. Os e2e casam por nome acessível, não por texto visível.
- **Sem prop de tamanho no `Botao`.** O `BotaoIcone` tem tamanho fixo. Reintroduzir override de altura por `className` recria o defeito do item 5.
- **Comentários e identificadores em português**, como o resto do `web/`.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `web/ui/src/Icone.tsx` | Conjunto de ícones SVG | Criar |
| `web/ui/src/Controle.tsx` | Sobrepõe ícone a select/input nativo | Criar |
| `web/ui/src/Botao.tsx` | `Botao` + `BotaoIcone`, variantes compartilhadas | Modificar |
| `web/ui/src/Campo.tsx` | Rótulo, erro, `CONTROLE`, `CONTROLE_INVALIDO` | Modificar |
| `web/ui/src/Tabela.tsx` | Alinhamento vertical da célula | Modificar |
| `web/ui/src/index.ts` | Exports públicos | Modificar |
| `web/admin/src/componentes/SeletorTaxonomia.tsx` | Combo de taxonomia com ícone | Modificar |
| `web/admin/src/componentes/ListaAlternativas.tsx` | Remover alternativa vira ícone; recebe erros | Modificar |
| `web/admin/src/lib/validacao.ts` | Regras de validação do editor | Criar |
| `web/admin/src/app/page.tsx` | Lista: filtros com ícone, ações em ícone | Modificar |
| `web/admin/src/app/taxonomias/page.tsx` | Abas com ícone, ações em ícone | Modificar |
| `web/admin/src/app/questoes/editar/page.tsx` | Ícones nos campos, validação, rodapé | Modificar |
| `web/admin/e2e/visual.spec.ts` | Alinhamento e paridade de altura | Criar |
| `web/admin/e2e/validacao.spec.ts` | Item 4 | Criar |
| `web/admin/e2e/editor.spec.ts` | Dois testes que mudam de premissa | Modificar |

---

### Task 1: Conjunto de ícones e alinhamento da tabela

Entrega os ícones que todas as tarefas seguintes consomem, e resolve o item 6.

**Files:**
- Create: `web/ui/src/Icone.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/ui/src/Tabela.tsx:53`
- Create: `web/admin/e2e/visual.spec.ts`

**Interfaces:**
- Produces: de `@mais/ui`, os componentes `IconeAssunto`, `IconeBanca`, `IconeAno`, `IconeCargo`, `IconeNivel`, `IconeSituacao`, `IconeTipo`, `IconeEditar`, `IconeExcluir`, `IconePublicar`, `IconeDespublicar`, `IconePreview`, `IconeAdicionar`, `IconeSalvar`, `IconeCancelar`. Todos com a assinatura `(props: { className?: string }) => JSX.Element`, todos já com `aria-hidden="true"`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/visual.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("a célula da tabela alinha o conteúdo ao meio da linha", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();

  const celula = page.locator("table tbody td").first();
  await expect(celula).toBeVisible();
  await expect(celula).toHaveCSS("vertical-align", "middle");
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts visual.spec.ts`
Expected: FAIL — `vertical-align` é `top`.

- [ ] **Step 3: Corrigir o alinhamento**

Em `web/ui/src/Tabela.tsx:53`, trocar `align-top` por `align-middle`:

```tsx
<td key={c.titulo} className="px-5 py-4 text-[14.5px] align-middle">
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts visual.spec.ts`
Expected: PASS

- [ ] **Step 5: Criar o conjunto de ícones**

Criar `web/ui/src/Icone.tsx`. O invólucro comum carrega o traço do `demo.html` e o `aria-hidden`; cada ícone só declara o desenho.

```tsx
import type { ReactNode } from "react";

/**
 * Traço único, herdado do docs/demo.html: contorno de 2px, pontas
 * arredondadas, sem preenchimento. Cor e tamanho vêm do contexto via
 * currentColor e className.
 *
 * aria-hidden é obrigatório: sem ele o conteúdo do SVG entra no nome
 * acessível do botão que o contém e quebra os seletores dos e2e.
 */
function Svg({
  className = "w-[18px] h-[18px]",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type PropsIcone = { className?: string };

// ---- taxonomias e campos de escolha (docs/demo.html) ----

export function IconeAssunto(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  );
}

export function IconeBanca(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </Svg>
  );
}

export function IconeAno(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  );
}

export function IconeCargo(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Svg>
  );
}

export function IconeNivel(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </Svg>
  );
}

export function IconeSituacao(p: PropsIcone) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}

export function IconeTipo(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </Svg>
  );
}

// ---- ações ----

export function IconeEditar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </Svg>
  );
}

export function IconeExcluir(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}

export function IconePublicar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconeDespublicar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </Svg>
  );
}

export function IconePreview(p: PropsIcone) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </Svg>
  );
}

export function IconeAdicionar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function IconeSalvar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </Svg>
  );
}

export function IconeCancelar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}
```

- [ ] **Step 6: Exportar os ícones**

Acrescentar em `web/ui/src/index.ts`:

```ts
export {
  IconeAssunto,
  IconeBanca,
  IconeAno,
  IconeCargo,
  IconeNivel,
  IconeSituacao,
  IconeTipo,
  IconeEditar,
  IconeExcluir,
  IconePublicar,
  IconeDespublicar,
  IconePreview,
  IconeAdicionar,
  IconeSalvar,
  IconeCancelar,
} from "./Icone";
```

- [ ] **Step 7: Verificar tipos e suíte inteira**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck limpo; todos os specs passam (o novo `visual.spec.ts` incluído).

- [ ] **Step 8: Commit**

```bash
git add web/ui/src/Icone.tsx web/ui/src/index.ts web/ui/src/Tabela.tsx web/admin/e2e/visual.spec.ts
git commit -m "feat(ui): conjunto de ícones do demo e alinhamento vertical da célula"
```

---

### Task 2: Ícone dentro dos campos de escolha e nas abas

Item 1. Cobre as quatro taxonomias mais Situação, Tipo e Ano.

**Files:**
- Create: `web/ui/src/Controle.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/componentes/SeletorTaxonomia.tsx`
- Modify: `web/admin/src/app/page.tsx` (campo Situação, ~linha 233)
- Modify: `web/admin/src/app/questoes/editar/page.tsx` (campos Tipo e Ano, ~linhas 187 e 212)
- Modify: `web/admin/src/app/taxonomias/page.tsx` (abas, ~linhas 140-160)
- Modify: `web/admin/e2e/visual.spec.ts`

**Interfaces:**
- Consumes: os ícones da Task 1.
- Produces: `Controle` de `@mais/ui`, assinatura `({ icone, children }: { icone: ReactNode; children: ReactNode }) => JSX.Element`. O consumidor aplica `CONTROLE` com `pl-11` no controle interno.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/visual.spec.ts`:

```ts
test("os campos de escolha e as abas exibem ícone sem afetar o nome acessível", async ({
  page,
}) => {
  await entrar(page);

  // O Controle envolve o select num div; o ícone fica num <span> irmão, então
  // o svg está a dois níveis do select — subir ao pai e descer é o caminho.
  const situacao = page.getByLabel("Situação");
  await expect(situacao).toBeVisible();
  await expect(situacao.locator("xpath=..").locator("svg")).toHaveCount(1);

  // O aria-hidden do ícone preserva o nome acessível da aba — sem ele,
  // getByRole("tab", { name: "Cargo" }) deixaria de casar.
  await page.goto("/taxonomias");
  const aba = page.getByRole("tab", { name: "Cargo" });
  await expect(aba).toBeVisible();
  await expect(aba.locator("svg")).toHaveCount(1);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts visual.spec.ts`
Expected: FAIL — nenhum `svg` encontrado.

- [ ] **Step 3: Criar o `Controle`**

Criar `web/ui/src/Controle.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Sobrepõe um ícone à esquerda de um controle nativo.
 *
 * Um <select> não aceita elemento filho além de <option>, então não há como
 * pôr o SVG dentro dele. Manter o select nativo importa — navegação por
 * teclado e o seletor de roda do iOS —, então o ícone fica posicionado por
 * cima, com pointer-events desligado para não roubar o clique que abre a
 * lista. O controle recebe pl-11 para abrir o espaço.
 */
export function Controle({
  icone,
  children,
}: {
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-roxo pointer-events-none flex">
        {icone}
      </span>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Exportar**

Acrescentar em `web/ui/src/index.ts`:

```ts
export { Controle } from "./Controle";
```

- [ ] **Step 5: Ligar o `SeletorTaxonomia`**

Substituir o corpo de `web/admin/src/componentes/SeletorTaxonomia.tsx` a partir do `const ROTULO`, mantendo todo o resto do arquivo intacto:

```tsx
const ROTULO: Record<TipoTermo, string> = {
  subject: "Assunto",
  banca: "Banca",
  cargo: "Cargo",
  level: "Nível",
};

const ICONE: Record<TipoTermo, () => React.JSX.Element> = {
  subject: IconeAssunto,
  banca: IconeBanca,
  cargo: IconeCargo,
  level: IconeNivel,
};
```

O import passa a ser:

```tsx
import {
  Campo,
  CONTROLE,
  Controle,
  IconeAssunto,
  IconeBanca,
  IconeCargo,
  IconeNivel,
} from "@mais/ui";
```

E o `<select>` é envolvido, ganhando `pl-11`:

```tsx
  const id = `taxonomia-${kind}`;
  const Icone = ICONE[kind];
  return (
    <Campo rotulo={rotulo ?? ROTULO[kind]} htmlFor={id} erro={erro}>
      <Controle icone={<Icone />}>
        <select
          id={id}
          className={`${CONTROLE} pl-11`}
          value={valor}
          required={obrigatorio}
          onChange={(e) => aoMudar(e.target.value)}
        >
          {/* Valor vazio = sem filtro. A API normaliza string vazia para
              ausente, mas o cliente nem chega a mandar (lib/api.ts). */}
          <option value="">{obrigatorio ? "Selecione…" : "Todos"}</option>
          {/* A questão pode apontar para um termo já excluído: a API o mantém
              na questão (updateQuestion só revalida a FK que mudou) mas não o
              devolve na lista de escolha. Sem esta opção fantasma, o select
              cairia no primeiro item e trocaria a taxonomia sem ninguém pedir. */}
          {valor !== "" && !termos.some((t) => t.id === valor) && (
            <option value={valor}>(termo excluído — mantido)</option>
          )}
          {termos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Controle>
    </Campo>
  );
```

- [ ] **Step 6: Ligar Situação, Tipo e Ano**

Em `web/admin/src/app/page.tsx`, o campo Situação passa a:

```tsx
<Campo rotulo="Situação" htmlFor="filtro-situacao">
  <Controle icone={<IconeSituacao />}>
    <select
      id="filtro-situacao"
      className={`${CONTROLE} pl-11`}
      value={filtros.status ?? ""}
      onChange={(e) => mudarFiltro("status", e.target.value)}
    >
      <option value="">Todas</option>
      <option value="draft">Rascunho</option>
      <option value="published">Publicada</option>
    </select>
  </Controle>
</Campo>
```

Em `web/admin/src/app/questoes/editar/page.tsx`, o campo Tipo:

```tsx
<Campo rotulo="Tipo" htmlFor="tipo">
  <Controle icone={<IconeTipo />}>
    <select
      id="tipo"
      className={`${CONTROLE} pl-11`}
      value={tipo}
      onChange={(e) => trocarTipo(e.target.value as TipoQuestao)}
    >
      <option value="multiple_choice">Múltipla escolha</option>
      <option value="true_false">Certo/errado</option>
    </select>
  </Controle>
</Campo>
```

e o campo Ano:

```tsx
<Campo rotulo="Ano" htmlFor="ano" dica="Opcional">
  <Controle icone={<IconeAno />}>
    <input
      id="ano"
      className={`${CONTROLE} pl-11`}
      inputMode="numeric"
      value={ano}
      onChange={(e) => setAno(e.target.value.replace(/\D/g, ""))}
    />
  </Controle>
</Campo>
```

Acrescentar `Controle`, `IconeSituacao`, `IconeTipo` e `IconeAno` aos imports de `@mais/ui` de cada arquivo.

- [ ] **Step 7: Ícone nas abas de taxonomia**

Em `web/admin/src/app/taxonomias/page.tsx`, o array `ABAS` ganha o ícone:

```tsx
const ABAS: {
  kind: TipoTermo;
  rotulo: string;
  Icone: () => React.JSX.Element;
}[] = [
  { kind: "banca", rotulo: "Banca", Icone: IconeBanca },
  { kind: "subject", rotulo: "Assunto", Icone: IconeAssunto },
  { kind: "cargo", rotulo: "Cargo", Icone: IconeCargo },
  { kind: "level", rotulo: "Nível", Icone: IconeNivel },
];
```

e o botão da aba passa a exibi-lo. O `aria-hidden` do ícone (Task 1) é o que mantém `getByRole("tab", { name: "Cargo" })` funcionando:

```tsx
<button
  key={item.kind}
  role="tab"
  aria-selected={aba === item.kind}
  onClick={() => {
    setAba(item.kind);
    setErro(null);
    setNome("");
  }}
  className={`px-4 h-11 rounded-btn border text-[14.5px] font-semibold transition-colors inline-flex items-center gap-2 ${
    aba === item.kind
      ? "border-roxo bg-roxo-bg text-roxo"
      : "border-borda-2 bg-card text-txt hover:border-borda-3"
  }`}
>
  <item.Icone />
  {item.rotulo}
</button>
```

- [ ] **Step 8: Rodar e verificar que passa**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck limpo; toda a suíte passa. Confirmar em especial `caminho-critico.spec.ts` (usa `getByRole("tab", …)` e `getByLabel("Ano")`) e `lista.spec.ts` (usa `getByLabel("Situação")`).

- [ ] **Step 9: Commit**

```bash
git add web/ui/src/Controle.tsx web/ui/src/index.ts web/admin/src web/admin/e2e/visual.spec.ts
git commit -m "feat(admin): ícone do demo nos campos de escolha e nas abas de taxonomia"
```

---

### Task 3: `BotaoIcone` e as ações de linha

Itens 3 (linhas) e 5. O teste de paridade de altura é o que prova o item 5 resolvido.

**Files:**
- Modify: `web/ui/src/Botao.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/app/page.tsx:164-198`
- Modify: `web/admin/src/app/taxonomias/page.tsx:106-134`
- Modify: `web/admin/src/componentes/ListaAlternativas.tsx:92-100`
- Modify: `web/admin/e2e/visual.spec.ts`

**Interfaces:**
- Consumes: ícones da Task 1.
- Produces: de `@mais/ui`:
  ```ts
  BotaoIcone(props: {
    icone: ReactNode;
    rotulo: string;
    variante?: VarianteBotao;   // "primario" | "secundario" | "perigo"
    disabled?: boolean;
    onClick?: () => void;
  }): JSX.Element

  classesBotaoIcone(variante?: VarianteBotao): string
  ```
  `BotaoIcone` renderiza sempre `<button>`, com `title={rotulo}` e
  `aria-label={rotulo}`. `classesBotaoIcone` devolve a mesma string de classes
  para quem precisa aplicá-la a outro elemento.

> **Por que não existe prop `href`.** A versão anterior deste plano previa
> `BotaoIcone` renderizando um `Link` do Next quando recebesse `href`. Isso
> obrigaria `web/ui` a importar `next`, e **quebraria o isolamento do pacote**:
> hoje há zero imports de `next` ali e o `ui/tsconfig.json` tem `types: []`.
> Esse isolamento é a propriedade que torna o `ui` entregável ao sub-projeto 4
> (`web/README.md:6-8`). A ação "Editar" continua sendo um `Link` do Next, mas
> declarado no `admin`, aplicando `classesBotaoIcone()` — a fonte de estilo
> segue única, que é o que conserta o item 5.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/visual.spec.ts`. Este teste é o item 5: hoje o "Editar" é um `<Link>` com estilo copiado à mão e os vizinhos são `Botao`, e as alturas divergem.

```ts
test("as ações da linha têm a mesma altura e expõem o rótulo como tooltip", async ({
  page,
}) => {
  await page.route("**/admin/questions**", async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        rows: [
          {
            id: "q-1",
            statement: "Questão de exemplo",
            type: "multiple_choice",
            status: "draft",
            year: 2024,
            subjectName: null,
            bancaName: null,
          },
        ],
      },
    });
  });

  await entrar(page);

  const linha = page.locator("table tbody tr").first();
  const editar = linha.getByRole("link", { name: "Editar" });
  const excluir = linha.getByRole("button", { name: "Excluir" });

  const caixaEditar = await editar.boundingBox();
  const caixaExcluir = await excluir.boundingBox();
  expect(caixaEditar?.height).toBe(caixaExcluir?.height);

  // O rótulo vira tooltip, e continua sendo o nome acessível.
  await expect(editar).toHaveAttribute("title", "Editar");
  await expect(excluir).toHaveAttribute("title", "Excluir");
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts visual.spec.ts`
Expected: FAIL — alturas diferentes, e nenhum `title`.

- [ ] **Step 3: Criar o `BotaoIcone`**

Acrescentar ao final de `web/ui/src/Botao.tsx`, reusando o `VARIANTE` que já existe no arquivo. **Não acrescentar nenhum import de `next`** — `Botao.tsx` importa apenas de `react`, como hoje.

```tsx
const BASE_ICONE =
  "inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-btn " +
  "transition-[background,transform,box-shadow] active:translate-y-px " +
  "disabled:opacity-55 disabled:cursor-not-allowed";

/**
 * As classes do botão-ícone, expostas para quem precisa aplicá-las a um
 * elemento que este pacote não pode construir — o caso concreto é o Link do
 * Next, que vive no `admin` porque `web/ui` não importa `next` (é o que o
 * mantém consumível pelo sub-projeto 4).
 */
export function classesBotaoIcone(
  variante: VarianteBotao = "secundario",
): string {
  return `${BASE_ICONE} ${VARIANTE[variante]}`;
}

/**
 * Ação representada só por ícone. O `rotulo` vira as duas coisas ao mesmo
 * tempo: `title` (o tooltip visível) e `aria-label` (o nome acessível, que é
 * o que leitor de tela e Playwright leem).
 *
 * O tamanho é fixo de propósito. O defeito que isto corrige era o `Botao`
 * normal ter altura no BASE e as chamadas a encolherem por className — dois
 * utilitários de altura na mesma classe, onde quem vence é a ordem de geração
 * do CSS e não a ordem da string. Era a causa do "Editar" desalinhado.
 */
export function BotaoIcone({
  icone,
  rotulo,
  variante = "secundario",
  className = "",
  ...resto
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icone: ReactNode;
  rotulo: string;
  variante?: VarianteBotao;
}) {
  return (
    <button
      {...resto}
      type="button"
      title={rotulo}
      aria-label={rotulo}
      className={`${classesBotaoIcone(variante)} ${className}`}
    >
      {icone}
    </button>
  );
}
```

O import no topo do arquivo passa de `import type { ButtonHTMLAttributes } from "react";` para incluir `ReactNode`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
```

- [ ] **Step 4: Exportar**

Em `web/ui/src/index.ts`:

```ts
export {
  Botao,
  BotaoIcone,
  classesBotaoIcone,
  type VarianteBotao,
} from "./Botao";
```

- [ ] **Step 5: Trocar as ações da lista de questões**

Em `web/admin/src/app/page.tsx`, a coluna "Ações" passa a:

```tsx
{
  titulo: "Ações",
  celula: (l) => (
    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
      {/* Clicar na linha também abre o editor, mas é conveniência, não a
          única via — sem um link explícito, quem navega só pelo teclado
          não tem como reabrir uma questão (a linha não é focável de
          propósito, ver Tabela.tsx). */}
      <Link
        href={`/questoes/editar?id=${l.id}`}
        title="Editar"
        aria-label="Editar"
        className={classesBotaoIcone()}
      >
        <IconeEditar />
      </Link>
      <BotaoIcone
        rotulo={l.status === "published" ? "Despublicar" : "Publicar"}
        icone={
          l.status === "published" ? <IconeDespublicar /> : <IconePublicar />
        }
        onClick={() => void alternarSituacao(l)}
      />
      <BotaoIcone
        variante="perigo"
        rotulo="Excluir"
        icone={<IconeExcluir />}
        onClick={() => setAExcluir(l)}
      />
    </div>
  ),
},
```

O `rotulo="Excluir"` sem qualificador é deliberado: `lista.spec.ts:139` busca `getByRole("button", { name: "Excluir" })`.

O `Link` continua importado no arquivo — é ele que constrói a ação "Editar" e o botão "Nova questão". O que sai é a string de classes copiada à mão que estava em `page.tsx:177`, substituída por `classesBotaoIcone()`. Acrescentar `BotaoIcone`, `classesBotaoIcone`, `IconeEditar`, `IconeExcluir`, `IconePublicar` e `IconeDespublicar` aos imports de `@mais/ui`.

- [ ] **Step 6: Trocar as ações da lista de taxonomias**

Em `web/admin/src/app/taxonomias/page.tsx`, a coluna "Ações":

```tsx
{
  titulo: "Ações",
  celula: (t) => (
    <div className="flex gap-2">
      <BotaoIcone
        rotulo={`Renomear ${t.name}`}
        icone={<IconeEditar />}
        onClick={() => {
          setARenomear(t);
          setNovoNome(t.name);
        }}
      />
      <BotaoIcone
        variante="perigo"
        rotulo={`Excluir ${t.name}`}
        icone={<IconeExcluir />}
        onClick={() => setAExcluir(t)}
      />
    </div>
  ),
},
```

Os rótulos interpolados são obrigatórios: `taxonomias.spec.ts:27` e `:35` buscam `"Renomear Cespe"` e `"Excluir Cebraspe"`.

- [ ] **Step 7: Trocar o remover-alternativa**

Em `web/admin/src/componentes/ListaAlternativas.tsx`, substituir o `Botao` com `✕`:

```tsx
<BotaoIcone
  variante="secundario"
  rotulo={`Remover alternativa ${LETRAS[i]}`}
  icone={<IconeExcluir />}
  disabled={alternativas.length <= 2}
  onClick={() => aoMudar(alternativas.filter((_, j) => j !== i))}
/>
```

`editor.spec.ts:31` busca `"Remover alternativa E"` — o rótulo interpolado preserva isso.

- [ ] **Step 8: Rodar e verificar que passa**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck limpo; suíte inteira passa, incluindo o novo teste de paridade de altura.

- [ ] **Step 9: Commit**

```bash
git add web/ui/src/Botao.tsx web/ui/src/index.ts web/admin/src web/admin/e2e/visual.spec.ts
git commit -m "feat(admin): ações de linha viram ícone com tooltip

Corrige na raiz a divergência de altura do botão Editar: o BASE do Botao e
o override por className disputavam h-/text-, e quem vencia era a ordem de
geração no CSS. Nenhum ponto de chamada sobra sobrescrevendo tamanho."
```

---

### Task 4: Botões de inserção e rodapé com texto + ícone

Item 2, e a parte do item 3 que fica fora das linhas.

**Files:**
- Modify: `web/admin/src/app/page.tsx` (botão "Nova questão", ~linha 206)
- Modify: `web/admin/src/app/taxonomias/page.tsx` (botão "Adicionar", ~linha 176)
- Modify: `web/admin/src/componentes/ListaAlternativas.tsx` ("Adicionar alternativa", ~linha 106)
- Modify: `web/admin/src/app/questoes/editar/page.tsx` (rodapé e "Pré-visualizar")

**Interfaces:**
- Consumes: ícones da Task 1. O `Botao` já aceita `children` e tem `gap-2` no BASE, então basta pôr o ícone antes do texto.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/visual.spec.ts`:

```ts
test("os botões de inserção e o rodapé do editor exibem ícone junto do texto", async ({
  page,
}) => {
  await entrar(page);

  const nova = page.getByRole("link", { name: "Nova questão" });
  await expect(nova.locator("svg")).toHaveCount(1);

  await page.goto("/taxonomias");
  await expect(
    page.getByRole("button", { name: "Adicionar" }).locator("svg"),
  ).toHaveCount(1);

  await page.goto("/questoes/editar");
  for (const nome of ["Salvar rascunho", "Publicar", "Cancelar", "Pré-visualizar"]) {
    await expect(
      page.getByRole("button", { name: nome }).locator("svg"),
    ).toHaveCount(1);
  }
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts visual.spec.ts`
Expected: FAIL — nenhum `svg` dentro desses botões.

- [ ] **Step 3: Botões de inserção**

Em `web/admin/src/app/page.tsx`:

```tsx
<Link href="/questoes/editar">
  <Botao>
    <IconeAdicionar />
    Nova questão
  </Botao>
</Link>
```

Em `web/admin/src/app/taxonomias/page.tsx`:

```tsx
<Botao type="submit" carregando={salvando}>
  <IconeAdicionar />
  Adicionar
</Botao>
```

Em `web/admin/src/componentes/ListaAlternativas.tsx`:

```tsx
<Botao
  variante="secundario"
  onClick={() => aoMudar([...alternativas, { body: "", isCorrect: false }])}
>
  <IconeAdicionar />
  Adicionar alternativa
</Botao>
```

> O `Botao` troca `children` por "Aguarde…" quando `carregando` (`Botao.tsx:37`), então o ícone some junto durante o envio. É o comportamento existente e está correto.

- [ ] **Step 4: Rodapé do editor**

Em `web/admin/src/app/questoes/editar/page.tsx`, o bloco de botões finais:

```tsx
<div className="flex gap-3 flex-wrap">
  {id ? (
    <>
      <Botao carregando={salvando} onClick={() => void salvar("draft")}>
        <IconeSalvar />
        Salvar
      </Botao>
      <Botao variante="secundario" onClick={() => void alternarSituacao()}>
        {situacao === "published" ? <IconeDespublicar /> : <IconePublicar />}
        {situacao === "published" ? "Despublicar" : "Publicar"}
      </Botao>
    </>
  ) : (
    <>
      <Botao
        variante="secundario"
        carregando={salvando}
        onClick={() => void salvar("draft")}
      >
        <IconeSalvar />
        Salvar rascunho
      </Botao>
      <Botao carregando={salvando} onClick={() => void salvar("published")}>
        <IconePublicar />
        Publicar
      </Botao>
    </>
  )}
  <Botao variante="secundario" onClick={() => router.push("/")}>
    <IconeCancelar />
    Cancelar
  </Botao>
</div>
```

e o botão de pré-visualização:

```tsx
<Botao variante="secundario" onClick={() => setVendoPreview((v) => !v)}>
  <IconePreview />
  {vendoPreview ? "Voltar a editar" : "Pré-visualizar"}
</Botao>
```

- [ ] **Step 5: Rodar e verificar que passa**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck limpo; suíte inteira passa. `preview.spec.ts` (busca "Pré-visualizar" e "Voltar a editar") e `caminho-critico.spec.ts` (busca "Publicar" e "Salvar rascunho") continuam verdes porque o ícone é `aria-hidden`.

- [ ] **Step 6: Commit**

```bash
git add web/admin/src web/admin/e2e/visual.spec.ts
git commit -m "feat(admin): ícone junto do texto nos botões de inserção e no rodapé do editor"
```

---

### Task 5: Validação por campo no editor

Item 4. Inclui a alteração de dois testes existentes cuja premissa muda.

**Files:**
- Create: `web/admin/src/lib/validacao.ts`
- Modify: `web/ui/src/Campo.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/componentes/ListaAlternativas.tsx`
- Modify: `web/admin/src/app/questoes/editar/page.tsx`
- Create: `web/admin/e2e/validacao.spec.ts`
- Modify: `web/admin/e2e/editor.spec.ts:56-95`

**Interfaces:**
- Consumes: `Campo` (prop `erro`), `CONTROLE`.
- Produces:
  ```ts
  type CampoQuestao =
    | "enunciado" | "subjectId" | "bancaId" | "ano"
    | "gabarito" | "videoUrl" | `alternativa-${number}` | "alternativas";

  type ErrosQuestao = Partial<Record<CampoQuestao, string>>;

  function validarQuestao(entrada: {
    enunciado: string;
    subjectId: string;
    bancaId: string;
    ano: string;
    videoUrl: string;
    alternativas: { body: string; isCorrect: boolean }[];
  }): ErrosQuestao;
  ```
  E de `@mais/ui`, a constante `CONTROLE_INVALIDO: string`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/validacao.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("salvar com pendências aponta os campos e não envia nada", async ({
  page,
}) => {
  await entrar(page);

  const envios: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/questions")) {
      envios.push(r.url());
    }
  });

  await page.goto("/questoes/editar");
  await page.getByLabel("Enunciado").fill("Enunciado preenchido.");
  await page.getByLabel("Vídeo do gabarito").fill("youtube.com/watch?v=abc");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  // O resumo no topo enumera o que falta.
  const resumo = page.locator("main").getByRole("alert").first();
  await expect(resumo).toContainText(/assunto/i);
  await expect(resumo).toContainText(/banca/i);

  // O campo do vídeo explica o problema dele, em vez da frase genérica.
  await expect(page.getByLabel("Vídeo do gabarito")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("main")).toContainText(/http:\/\/ ou https:\/\//i);

  // Nada foi enviado ao servidor.
  expect(envios).toHaveLength(0);
});

test("corrigidos os campos, o resumo some", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("tab", { name: "Assunto" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Português");
  await page.getByRole("button", { name: "Adicionar" }).click();

  await page.goto("/questoes/editar");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator("main").getByRole("alert").first()).toBeVisible();

  await page.getByLabel("Enunciado").fill("Enunciado completo.");
  await page.getByLabel("Assunto").selectOption({ label: "Português" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page).toHaveURL("http://localhost:3000/");
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npx playwright test -c admin/e2e/playwright.config.ts validacao.spec.ts`
Expected: FAIL — hoje a requisição sai e a mensagem é a genérica.

- [ ] **Step 3: Escrever as regras**

Criar `web/admin/src/lib/validacao.ts`:

```ts
/**
 * Regras que o cliente sabe conferir antes de enviar.
 *
 * Deliberadamente um subconjunto do schema do servidor, não uma cópia dele:
 * aqui só entra o que dá para apontar num campo da tela. O que a API recusar
 * além disto continua caindo na mensagem genérica de `mensagemDe`, e a API
 * segue sendo a autoridade.
 */

export type CampoQuestao =
  | "enunciado"
  | "subjectId"
  | "bancaId"
  | "ano"
  | "gabarito"
  | "videoUrl"
  | `alternativa-${number}`
  | "alternativas";

export type ErrosQuestao = Partial<Record<CampoQuestao, string>>;

/** O enunciado é HTML do editor; vazio de verdade é só a moldura do TipTap. */
function vazio(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

export function validarQuestao(entrada: {
  enunciado: string;
  subjectId: string;
  bancaId: string;
  ano: string;
  gabarito: string;
  videoUrl: string;
  alternativas: { body: string; isCorrect: boolean }[];
}): ErrosQuestao {
  const erros: ErrosQuestao = {};

  if (vazio(entrada.enunciado)) {
    erros.enunciado = "Escreva o enunciado da questão.";
  }
  // explanation.body é z.string().min(1) no servidor
  // (api/src/routes/admin/questions.ts:65) — obrigatório, não opcional.
  if (vazio(entrada.gabarito)) {
    erros.gabarito = "Escreva o gabarito comentado.";
  }
  if (!entrada.subjectId) erros.subjectId = "Escolha o assunto.";
  if (!entrada.bancaId) erros.bancaId = "Escolha a banca.";

  if (entrada.ano) {
    const n = Number(entrada.ano);
    if (n < 1900 || n > 2200) erros.ano = "Use um ano entre 1900 e 2200.";
  }

  entrada.alternativas.forEach((alt, i) => {
    if (alt.body.trim() === "") {
      erros[`alternativa-${i}`] = "Preencha o texto desta alternativa.";
    }
  });

  if (entrada.alternativas.filter((a) => a.isCorrect).length !== 1) {
    // Mesma frase de erros.ts para o código exactly_one_correct — o operador
    // não deve receber texto diferente conforme quem barrou.
    erros.alternativas = "Marque exatamente uma alternativa como correta.";
  }

  if (entrada.videoUrl && !/^https?:\/\//i.test(entrada.videoUrl)) {
    erros.videoUrl = "Use um endereço começando com http:// ou https://.";
  }

  return erros;
}

/** Rótulos para o resumo no topo, na ordem em que aparecem no formulário. */
export const ROTULO_CAMPO: Record<string, string> = {
  enunciado: "Enunciado",
  subjectId: "Assunto",
  bancaId: "Banca",
  ano: "Ano",
  gabarito: "Gabarito comentado",
  videoUrl: "Vídeo do gabarito",
  alternativas: "Alternativas",
};
```

- [ ] **Step 4: Estado inválido do controle**

Em `web/ui/src/Campo.tsx`, acrescentar após o `CONTROLE` existente:

```ts
/** Aplicado junto do CONTROLE quando o campo tem erro. Vence por vir depois. */
export const CONTROLE_INVALIDO = "border-erro focus:border-erro";
```

e em `web/ui/src/index.ts`:

```ts
export { Campo, CONTROLE, CONTROLE_INVALIDO } from "./Campo";
```

- [ ] **Step 5: Ligar no editor**

Em `web/admin/src/app/questoes/editar/page.tsx`:

```tsx
const [erros, setErros] = useState<ErrosQuestao>({});
```

`salvar` passa a validar antes de enviar:

```tsx
async function salvar(status: SituacaoQuestao) {
  const achados = validarQuestao({
    enunciado,
    subjectId,
    bancaId,
    ano,
    gabarito,
    videoUrl,
    alternativas,
  });
  setErros(achados);
  if (Object.keys(achados).length > 0) {
    setErro(null);
    // Rola até o primeiro campo marcado; o resumo fica no topo do formulário.
    document
      .querySelector("[data-resumo-erros]")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  setErro(null);
  setSalvando(true);
  try {
    if (id) {
      // PATCH não carrega status de propósito (api/src/routes/admin/
      // questions.ts:73-84). Situação muda pelos botões de publicar.
      await api.salvarQuestao(id, montarEntrada());
      avisar("Questão salva.");
    } else {
      await api.criarQuestao(montarEntrada(), status);
      avisar(status === "published" ? "Questão publicada." : "Rascunho salvo.");
      router.push("/");
    }
  } catch (falha) {
    setErro(mensagemDe(falha));
  } finally {
    setSalvando(false);
  }
}
```

O resumo, renderizado logo antes do primeiro `Card`:

```tsx
{Object.keys(erros).length > 0 && (
  <div
    data-resumo-erros
    role="alert"
    className="rounded-row border border-erro bg-erro-bg p-4"
  >
    <p className="font-bold text-erro mb-2">
      Corrija {Object.keys(erros).length} ponto(s) para salvar:
    </p>
    <ul className="flex flex-col gap-1 text-[14px] text-erro">
      {Object.entries(erros).map(([campo, mensagem]) => (
        <li key={campo}>
          <strong>
            {ROTULO_CAMPO[campo] ??
              `Alternativa ${LETRAS[Number(campo.split("-")[1])]}`}
          </strong>{" "}
          — {mensagem}
        </li>
      ))}
    </ul>
  </div>
)}
```

A letra da alternativa vem de `ListaAlternativas`, que já a define. **Não criar uma terceira cópia da constante:** tornar a existente exportada em `web/admin/src/componentes/ListaAlternativas.tsx`

```tsx
export const LETRAS = "ABCDEFGHIJ";
```

e importá-la no editor:

```tsx
import {
  ALTERNATIVAS_VF,
  LETRAS,
  ListaAlternativas,
  type AlternativaForm,
} from "@/componentes/ListaAlternativas";
```

usando `LETRAS[...]` no lugar de `LETRAS_RESUMO[...]` no resumo. A cópia em `Preview.tsx` é pré-existente e fica fora deste plano.

Os campos passam o erro adiante:

```tsx
<SeletorTaxonomia
  kind="subject"
  valor={subjectId}
  aoMudar={setSubjectId}
  obrigatorio
  erro={erros.subjectId}
/>
```

(idem para `bancaId`). Os dois campos de editor recebem o erro pelo `Campo`, que já sabe exibi-lo — o TipTap não usa `CONTROLE`, então não há classe a aplicar:

```tsx
<Campo rotulo="Enunciado" erro={erros.enunciado}>
  <Editor
    valor={enunciado}
    aoMudar={setEnunciado}
    rotulo="Enunciado"
    comTabela
    minAltura={200}
  />
</Campo>
```

```tsx
<Campo rotulo="Gabarito comentado" erro={erros.gabarito}>
  <Editor
    valor={gabarito}
    aoMudar={setGabarito}
    rotulo="Gabarito comentado"
    minAltura={160}
  />
</Campo>
```

E os controles diretos ganham a classe e o `aria-invalid`:

```tsx
<Campo rotulo="Ano" htmlFor="ano" dica="Opcional" erro={erros.ano}>
  <Controle icone={<IconeAno />}>
    <input
      id="ano"
      className={`${CONTROLE} pl-11 ${erros.ano ? CONTROLE_INVALIDO : ""}`}
      aria-invalid={erros.ano ? true : undefined}
      inputMode="numeric"
      value={ano}
      onChange={(e) => setAno(e.target.value.replace(/\D/g, ""))}
    />
  </Controle>
</Campo>
```

```tsx
<Campo
  rotulo="Vídeo do gabarito"
  htmlFor="video"
  dica="Opcional. Endereço http ou https."
  erro={erros.videoUrl}
>
  <input
    id="video"
    className={`${CONTROLE} ${erros.videoUrl ? CONTROLE_INVALIDO : ""}`}
    aria-invalid={erros.videoUrl ? true : undefined}
    value={videoUrl}
    onChange={(e) => setVideoUrl(e.target.value)}
  />
</Campo>
```

E a lista de alternativas recebe os erros:

```tsx
<ListaAlternativas
  tipo={tipo}
  alternativas={alternativas}
  aoMudar={setAlternativas}
  erros={erros}
/>
```

- [ ] **Step 6: Marcar a alternativa com erro**

Em `web/admin/src/componentes/ListaAlternativas.tsx`, os imports passam a incluir `CONTROLE_INVALIDO` e o tipo:

```tsx
import { Botao, BotaoIcone, Campo, CONTROLE, CONTROLE_INVALIDO } from "@mais/ui";
import type { ErrosQuestao } from "@/lib/validacao";
```

a assinatura do componente ganha `erros?: ErrosQuestao`, e o input de cada alternativa:

```tsx
<input
  className={`${CONTROLE} ${
    erros?.[`alternativa-${i}`] ? CONTROLE_INVALIDO : ""
  }`}
  aria-invalid={erros?.[`alternativa-${i}`] ? true : undefined}
  aria-label={`Alternativa ${LETRAS[i]}`}
  value={alt.body}
  onChange={(e) =>
    aoMudar(
      alternativas.map((a, j) =>
        j === i ? { ...a, body: e.target.value } : a,
      ),
    )
  }
/>
```

- [ ] **Step 7: Ajustar os dois testes cuja premissa mudou**

Em `web/admin/e2e/editor.spec.ts`, o teste de linha 78 ("vídeo com `mailto:` é recusado") **falha** a partir daqui: o cliente barra antes do envio e a mensagem deixa de ser a genérica. Substituir por:

```ts
test("vídeo sem esquema http é barrado antes de chegar na API", async ({
  page,
}) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Enunciado de teste.");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  await page.getByLabel("Vídeo do gabarito").fill("mailto:alguem@exemplo.com");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  // Antes esta asserção era /confira os campos/i — a frase genérica que a API
  // devolve para qualquer rejeição do Zod. O ponto do item 4 é justamente que
  // ela não dizia qual campo estava errado.
  await expect(page.getByLabel("Vídeo do gabarito")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("main")).toContainText(/http:\/\/ ou https:\/\//i);
});
```

O teste de linha 56 ("sem alternativa correta, a API recusa e a tela explica") continua passando — a frase do cliente é a mesma de `erros.ts:13` —, mas o nome e o comentário passam a mentir. Renomear e ajustar:

```ts
test("sem alternativa correta, a tela explica antes de enviar", async ({
  page,
}) => {
```

e trocar o comentário `// Nenhuma marcada como correta.` por:

```ts
  // Nenhuma marcada como correta. Desde o item 4 quem barra é o cliente, com
  // a mesma frase que a API usaria para exactly_one_correct.
```

- [ ] **Step 8: Rodar e verificar que passa**

Run: `cd web && npm run typecheck && npm test`
Expected: typecheck limpo; toda a suíte passa, incluindo `validacao.spec.ts` e o `editor.spec.ts` ajustado.

- [ ] **Step 9: Commit**

```bash
git add web/ui/src web/admin/src web/admin/e2e
git commit -m "feat(admin): validação por campo no editor de questão

O servidor só devolve invalid_request sem indicar campo, então a informação
por campo passa a existir no cliente, antes do envio. A API segue sendo a
autoridade: o que ela recusar e o cliente não previu continua caindo na
mensagem genérica.

Dois e2e mudam de premissa porque o cliente agora barra antes da rede."
```

---

## Verificação final

- [ ] `cd web && npm run typecheck` — os dois workspaces, limpo.
- [ ] `cd web && npm test` — Playwright, tudo verde.
- [ ] `cd web && npm run audit` — sem achados (estado atual do `web/`).
- [ ] Inspeção manual em Firefox ou Chrome, com os dois servidores no ar. **Não usar Safari:** ele não armazena cookie `Secure` sobre `http://localhost`, então a sessão não persiste — é limitação do WebKit em desenvolvimento, não defeito do painel.

## Dívida registrada, fora deste plano

- Regras de validação duplicadas entre `web/admin/src/lib/validacao.ts` e o schema Zod da API. O cliente cobre só o subconjunto que consegue apontar na tela; ainda assim, podem divergir.
- `Bot` duplicado entre `BarraFerramentas.tsx` e `UploadImagem.tsx`. Consolidar é trabalho à parte.
- `LETRAS` duplicado entre `Preview.tsx` e `ListaAlternativas.tsx`. Este plano **não** acrescenta um terceiro ponto — o editor importa a constante de `ListaAlternativas` —, mas a cópia do `Preview.tsx` continua lá.
- Os demais itens de `plans/2026-08-07-painel-follow-ups.md`.
