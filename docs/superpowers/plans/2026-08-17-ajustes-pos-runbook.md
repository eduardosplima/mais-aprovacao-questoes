# Ajustes pós-runbook — Turnstile, Safari e obrigatoriedade de campos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o tema do widget Turnstile, a sobreposição de ícone e texto nos `<select>` do Safari, e inverter a obrigatoriedade de Ano (passa a obrigatório) e Gabarito comentado (passa a opcional).

**Architecture:** Três ajustes independentes entre si, agrupados só por virem da mesma rodada. Os dois primeiros são de apresentação e ficam contidos em `web/`; o terceiro atravessa a validação do servidor, a camada de persistência e a tela. Nenhum exige migração de banco.

**Tech Stack:** Hono + Zod + Drizzle sobre D1 (`api/`), Next.js 16 com `output: 'export'` + Tailwind v4 (`web/`), Vitest com `@cloudflare/vitest-pool-workers` (`api/`), Playwright (`web/admin/e2e`).

**Spec:** não há documento de spec separado. As decisões foram tomadas em conversa e estão registradas na seção *Contexto e decisões* abaixo — ela é a spec deste plano.

## Global Constraints

- **Não instalar pacote npm novo.** Nenhuma task precisa, e trazer dependência exige autorização explícita do dono do projeto.
- **`npx playwright install webkit` está autorizado**, pelo dono, em 2026-08-17, e só ele. É download de binário de navegador, não pacote npm: o `@playwright/test@1.61.1` já está em `devDependencies`, e o binário que ele baixa é o casado com essa versão. Nenhum `package.json` muda.
- **`workers: 1` e `fullyParallel: false` não podem ser mexidos.** Há um D1 local só, e cada spec chama `semear()` no `beforeAll`, que apaga tabelas. Com dois projetos de navegador, paralelismo passaria a ser corrida entre o seed de um e os testes do outro. Em série, os dois projetos convivem — ao custo de dobrar o tempo da suíte.
- **O acervo de produção está vazio.** Confirmado pelo dono em 2026-08-17. É o que dispensa migração de dados nas Tasks 4 e 5.
- **A suíte do `api/` tem 325 testes e deve continuar inteiramente verde** ao fim de cada task.
- **Comandos:** `api/` → `npx vitest run` e `npx tsc --noEmit`. `web/` → `npm run typecheck` e `npm run test -w admin` (Playwright; chromium só até a Task 2, chromium + webkit depois dela).
- **Idioma:** código, comentários, mensagens de erro e commits em português, como todo o repositório.

## Contexto e decisões

Quatro decisões foram tomadas antes deste plano e não devem ser reabertas durante a execução:

1. **Turnstile fixa em `light`.** A opção de tema segue o sistema operacional por padrão (`auto`), e o painel é claro. O dono decidiu não construir dark theme agora, então o tema fica travado no claro.
2. **A seta do `<select>` passa a ser desenhada pelo projeto, em todos os navegadores.** É consequência aceita de `appearance-none`, que é a única correção não-hack para o Safari.
3. **Gabarito ausente não grava linha em `explanations`.** Não é string vazia. "Sem gabarito" e "gabarito vazio" passam a ser a mesma coisa, representada pela ausência da linha. A coluna `body` continua `NOT NULL` e está correta assim — por isso não há migração.
4. **Ano passa a ser obrigatório na criação e edição de questão.** O filtro `?year=` da listagem **continua opcional** e não deve ser tocado.

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `web/admin/src/app/login/page.tsx` | tela de login; monta o widget Turnstile à mão | 1 |
| `web/ui/src/Campo.tsx` | classes compartilhadas de controle de formulário | 3 |
| `web/ui/src/Controle.tsx` | sobreposição de ícone (e agora seta) em controles nativos | 3 |
| `web/ui/src/Icone.tsx` | biblioteca de ícones de traço único | 3 |
| `web/ui/src/index.ts` | superfície pública do pacote `@mais/ui` | 3 |
| `web/admin/src/componentes/SeletorTaxonomia.tsx` | `<select>` de taxonomia | 3 |
| `web/admin/src/app/page.tsx` | listagem; `<select>` de situação | 3 |
| `web/admin/src/app/questoes/editar/page.tsx` | editor; `<select>` de tipo, campos Ano e Gabarito | 3, 4, 5 |
| `web/admin/e2e/playwright.config.ts` | configuração dos e2e; lista de navegadores | 2 |
| `web/admin/e2e/visual.spec.ts` | e2e de detalhes visuais | 3 |
| `api/src/routes/admin/questions.ts` | schemas Zod de escrita | 4, 5 |
| `api/src/db/questions.ts` | tipos de entrada e escrita de filhos | 4, 5 |
| `web/admin/src/lib/validacao.ts` | validação de cliente | 4, 5 |
| `web/admin/src/lib/api.ts` | tipos do cliente HTTP | 4, 5 |
| `api/test/admin-questions.test.ts` | testes de rota | 4, 5 |
| `api/test/questions-db.test.ts` | testes da camada de persistência | 5 |
| `web/admin/e2e/validacao.spec.ts` | e2e da validação de cliente | 4, 5 |
| `web/admin/e2e/editor.spec.ts`, `caminho-critico.spec.ts` | e2e que salvam questão | 4 |

---

### Task 1: Turnstile fixo no tema claro

**Files:**
- Modify: `web/admin/src/app/login/page.tsx:13-21` (declaração de tipo) e `:47-54` (chamada de render)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nada que tasks posteriores consumam.

**Sobre teste:** esta task não tem teste automatizado, e isso é deliberado. O widget é renderizado por um script de terceiro carregado de `challenges.cloudflare.com`, que o Playwright não alcança em ambiente de teste; e "renderizou claro" é uma propriedade visual do iframe da Cloudflare, não do nosso DOM. A verificação é o typecheck (que prova que a opção existe no tipo) mais conferência a olho. Não invente um teste que apenas reafirme a linha que você acabou de escrever.

- [ ] **Step 1: Acrescentar `theme` à declaração de tipo do widget**

Em `web/admin/src/app/login/page.tsx`, o bloco `declare global` descreve a API do Turnstile que usamos. Substitua o tipo de `opts`:

```ts
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
    };
  }
}
```

- [ ] **Step 2: Passar `theme: "light"` na chamada de render**

No `useEffect` que monta o widget, acrescente a opção e o comentário que explica por que ela existe — sem ele, alguém remove a linha achando que é redundante:

```ts
        window.turnstile.render(widget.current, {
          sitekey: SITE_KEY,
          callback: setToken,
          // O padrão do Turnstile é `auto`, que segue o prefers-color-scheme
          // do sistema. O painel é claro e não tem tema escuro, então em quem
          // usa o macOS no escuro o widget aparecia escuro dentro de um card
          // branco. Fixar em `light` é o que casa com o resto da tela.
          theme: "light",
        });
```

- [ ] **Step 3: Verificar que compila**

Run: `cd web && npm run typecheck`
Expected: sem erros. Se `theme` não existisse no tipo do Step 1, o TypeScript reprovaria aqui — é isso que torna o Step 1 uma verificação e não enfeite.

- [ ] **Step 4: Commit**

```bash
git add web/admin/src/app/login/page.tsx
git commit -m "fix(web): fixa o Turnstile no tema claro

O padrão do widget é `auto`, que segue o prefers-color-scheme do
sistema. Como o painel não tem tema escuro, quem usa o macOS no escuro
via um widget escuro dentro de um card branco.

Sem teste automatizado de propósito: o widget é um iframe servido pela
Cloudflare e o tema é propriedade dele, não do nosso DOM. O typecheck
cobre a única parte que é nossa, que é a opção existir no tipo."
```

---

### Task 2: WebKit na suíte e2e

**Files:**
- Modify: `web/admin/e2e/playwright.config.ts:20`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: um projeto Playwright chamado `webkit`. A Task 3 depende dele para testar o sintoma real do bug do Safari, em vez de um proxy. **Esta task tem de vir antes da Task 3.**

**Por que esta task existe e por que ela vem antes.** O bug da Task 3 só se manifesta no Safari, e a suíte roda só chromium. Sem WebKit, o teste da Task 3 seria obrigado a afirmar a *causa* (`appearance: none`) em vez do *sintoma* (o padding descartado) — cobertura de segunda categoria, que passa mesmo se a correção estiver errada por outro motivo. Com WebKit disponível primeiro, a Task 3 vira TDD de verdade: escreve o teste, vê falhar pelo motivo certo, corrige.

**O risco desta task, e é real.** A suíte nunca rodou em WebKit. É provável que apareça falha que não tem nada a ver com a nossa rodada — diferença de renderização, de timing, de comportamento de formulário. **Não conserte essas falhas.** Catalogue e reporte: consertar bug de Safari desconhecido é escopo que ninguém aprovou, e o dono precisa decidir item a item. Uma suíte parcialmente vermelha em WebKit, documentada, é um resultado honesto desta task.

- [ ] **Step 1: Baixar o binário do WebKit**

Autorizado explicitamente pelo dono em 2026-08-17. Nenhum `package.json` muda — o `@playwright/test@1.61.1` já está declarado, e este comando baixa o navegador casado com ele.

Run: `cd web/admin && npx playwright install webkit`
Expected: download concluído. Confirme com `npx playwright install --dry-run webkit`, que deve listar o WebKit como já instalado.

- [ ] **Step 2: Medir a linha de base, antes de mexer na config**

Antes de acrescentar o projeto, registre quanto tempo a suíte leva hoje e que ela está verde. É o número contra o qual você vai comparar depois.

Run: `cd web && npm run test -w admin`
Expected: verde. Anote a duração.

- [ ] **Step 3: Acrescentar o projeto webkit**

Em `web/admin/e2e/playwright.config.ts`, substitua a linha 20:

```ts
  /**
   * Dois navegadores, e o WebKit não é luxo: ele é o único lugar onde o
   * `<select>` com aparência nativa descarta o padding do autor, que foi o
   * bug de sobreposição de ícone e texto corrigido em 2026-08-17. Chromium
   * sozinho não observa essa classe de defeito.
   *
   * Rodam em série, não em paralelo — ver `workers: 1` acima. Os dois
   * projetos compartilham o mesmo D1 local, e cada spec chama `semear()`,
   * que apaga tabelas.
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
```

- [ ] **Step 4: Rodar a suíte inteira nos dois navegadores**

Run: `cd web && npm run test -w admin`
Expected: o número de testes dobra. O chromium continua verde.

O WebKit é a incógnita. Três desfechos possíveis, e cada um tem uma ação diferente:

1. **Tudo verde.** Siga para o Step 5.
2. **Falha só em `visual.spec.ts`, na contagem de `svg` ou algo do `<select>`.** Improvável, mas se acontecer é o bug da Task 3 se manifestando. Deixe falhando e anote — a Task 3 conserta.
3. **Falha em qualquer outra coisa.** **Pare.** Não conserte. Rode `npx playwright show-report` para ver o trace, anote qual spec, qual asserção e o que o WebKit fez de diferente, e reporte ao dono antes de seguir.

- [ ] **Step 5: Confirmar que o chromium não regrediu**

Run: `cd web && npm run test -w admin -- --project=chromium`
Expected: verde, e na mesma duração do Step 2. Serve para separar "o WebKit é lento" de "eu quebrei alguma coisa".

- [ ] **Step 6: Commit**

```bash
git add web/admin/e2e/playwright.config.ts
git commit -m "test(web): acrescenta o WebKit à suíte e2e

A suíte rodava só chromium, e existe uma classe inteira de defeito que
ela não observa: o Safari descarta o padding declarado pelo autor num
<select> com aparência nativa. Foi assim que a sobreposição de ícone e
texto passou despercebida até um humano abrir o painel no Safari.

Os dois projetos rodam em série. workers: 1 e fullyParallel: false
continuam obrigatórios — o D1 local é um só e cada spec chama semear(),
que apaga tabelas. O custo é dobrar a duração da suíte.

O binário do WebKit foi baixado com autorização explícita do dono.
Nenhum pacote npm entrou: o @playwright/test já estava declarado."
```

---

### Task 3: `<select>` do Safari — ícone e texto sobrepostos

**Files:**
- Modify: `web/ui/src/Campo.tsx:39-42` (acrescentar `CONTROLE_SELECT`)
- Modify: `web/ui/src/Icone.tsx` (acrescentar `IconeSeta`)
- Modify: `web/ui/src/Controle.tsx` (prop `seta`, e corrigir o comentário do topo)
- Modify: `web/ui/src/index.ts` (exportar `CONTROLE_SELECT` e `IconeSeta`)
- Modify: `web/admin/src/componentes/SeletorTaxonomia.tsx:63-70`
- Modify: `web/admin/src/app/page.tsx:244-247`
- Modify: `web/admin/src/app/questoes/editar/page.tsx:253-257`
- Test: `web/admin/e2e/visual.spec.ts:19-36`

**Interfaces:**
- Consumes: o projeto `webkit` da Task 2. **Esta task não pode começar sem ele** — sem WebKit o teste do Step 1 passa desde o início e não prova nada.
- Produces: `CONTROLE_SELECT: string` e `IconeSeta: ComponenteIcone`, exportados de `@mais/ui`; `Controle` passa a aceitar `seta?: boolean`. As Tasks 4 e 5 mexem no mesmo arquivo `editar/page.tsx`, mas em campos diferentes — não há conflito de conteúdo.

**O diagnóstico, para você não desfazer a correção por engano.** O Safari, enquanto `appearance: auto` estiver valendo num `<select>`, **descarta o padding declarado pelo autor**. Confirmado no inspetor: `padding-left: 0px` computado com `.pl-11` presente na cascata em `@layer utilities`. O ícone fica em `left-3.5` e o texto começa em 0 — daí a sobreposição. O Chrome respeita o padding, e por isso o bug só aparece no Safari.

**O comentário do `Controle.tsx` está errado e é parte da correção.** Ele hoje argumenta para manter a aparência nativa alegando navegação por teclado e o seletor de roda do iOS. `appearance: none` remove apenas o *desenho* nativo; o comportamento do `<select>` — teclado, roda do iOS, VoiceOver — permanece idêntico. Deixar o comentário como está garante que alguém reverta isto no futuro.

- [ ] **Step 1: Atualizar o teste do ícone, que vai passar a falhar**

`web/admin/e2e/visual.spec.ts` afirma hoje que o pai do `<select>` tem **exatamente um** `<svg>`. Com a seta desenhada por nós passam a ser dois. Reescreva o teste para afirmar as duas coisas que importam — que o ícone da esquerda continua lá, e que a seta existe — e acrescente a asserção de `appearance`:

```ts
test("os campos de escolha e as abas exibem ícone sem afetar o nome acessível", async ({
  page,
}) => {
  await entrar(page);

  // O Controle envolve o select num div; o ícone fica num <span> irmão, então
  // o svg está a dois níveis do select — subir ao pai e descer é o caminho.
  // São dois: o ícone do campo, à esquerda, e a seta do dropdown, à direita.
  const situacao = page.getByLabel("Situação");
  await expect(situacao).toBeVisible();
  await expect(situacao.locator("xpath=..").locator("svg")).toHaveCount(2);

  // O aria-hidden do ícone preserva o nome acessível da aba — sem ele,
  // getByRole("tab", { name: "Cargo" }) deixaria de casar.
  await page.goto("/taxonomias");
  const aba = page.getByRole("tab", { name: "Cargo" });
  await expect(aba).toBeVisible();
  await expect(aba.locator("svg")).toHaveCount(1);
});

/**
 * Este é o teste do bug de 2026-08-17, e ele só tem valor no WebKit.
 *
 * O sintoma: o Safari descarta o padding declarado pelo autor enquanto a
 * aparência nativa do <select> estiver ligada. O texto começava colado na
 * borda, em cima do ícone que o Controle sobrepõe em left-3.5.
 *
 * Mede-se o padding computado, não `appearance`. A diferença importa: uma
 * correção que ponha `appearance: none` e esqueça o `pl-11` passaria numa
 * asserção sobre `appearance` e continuaria com o bug na tela.
 *
 * No chromium ele passa desde sempre, porque lá o padding sempre funcionou.
 * Isso é esperado e não o torna inútil: é a mesma asserção valendo nos dois,
 * e é no WebKit que ela morde.
 */
test("o select reserva espaço para o ícone, inclusive no WebKit", async ({
  page,
}) => {
  await entrar(page);

  const situacao = page.getByLabel("Situação");
  await expect(situacao).toBeVisible();

  // pl-11 = 11 × 0.25rem = 44px.
  await expect(situacao).toHaveCSS("padding-left", "44px");
});
```

- [ ] **Step 2: Rodar e ver falhar — e conferir *onde* falha**

Run: `cd web && npm run test -w admin -- visual.spec.ts`

Expected, e leia com atenção porque a assimetria é o ponto:

| Projeto | Teste do ícone | Teste do padding |
|---|---|---|
| chromium | **FALHA** — `toHaveCount(2)` recebe 1, porque a seta ainda não existe | **PASSA** — o chromium sempre respeitou o padding |
| webkit | **FALHA** — mesma razão | **FALHA** — recebe `0px`, que é o bug |

Se o teste do padding **passar no WebKit**, pare: ou o projeto webkit não está ativo (confira a Task 2), ou o diagnóstico está errado e a correção abaixo não é a certa. Não siga em frente com o teste passando — você estaria escrevendo código sem saber o que ele conserta.

- [ ] **Step 3: Acrescentar o ícone de seta**

Em `web/ui/src/Icone.tsx`, junto dos demais ícones, seguindo o mesmo padrão de traço único do arquivo:

```tsx
/** Seta do dropdown. Substitui a nativa, que some com `appearance: none`. */
export const IconeSeta: ComponenteIcone = ({ className }) => (
  <Svg className={className}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
```

- [ ] **Step 4: Acrescentar a classe de controle para `<select>`**

Em `web/ui/src/Campo.tsx`, logo abaixo de `CONTROLE`:

```ts
/**
 * Para `<select>`. Duas diferenças em relação ao CONTROLE comum, e as duas
 * são obrigatórias juntas:
 *
 * `appearance-none` existe por causa do Safari, que descarta o padding
 * declarado pelo autor enquanto a aparência nativa estiver ligada — o texto
 * começava na borda e batia no ícone da esquerda. O Chrome respeitava, então
 * o bug só aparecia no Safari.
 *
 * `pr-10` abre espaço para a seta, que passa a ser nossa: `appearance-none`
 * remove também a seta nativa. O `pl-11` é o espaço do ícone do campo, que
 * todos os três selects do projeto já usavam.
 */
export const CONTROLE_SELECT = CONTROLE + " appearance-none pl-11 pr-10";
```

- [ ] **Step 5: Ensinar o `Controle` a desenhar a seta, e corrigir o comentário**

Reescreva `web/ui/src/Controle.tsx` inteiro:

```tsx
import type { ReactNode } from "react";
import { IconeSeta } from "./Icone";

/**
 * Sobrepõe um ícone à esquerda de um controle nativo e, opcionalmente, uma
 * seta de dropdown à direita.
 *
 * Um <select> não aceita elemento filho além de <option>, então não há como
 * pôr o SVG dentro dele. Os dois ficam posicionados por cima, com
 * pointer-events desligado para não roubar o clique que abre a lista.
 *
 * A seta é nossa porque `CONTROLE_SELECT` usa `appearance-none`, que remove a
 * nativa junto com a aparência. Isso **não** troca o <select> por um widget
 * customizado: `appearance: none` altera só o desenho. Navegação por teclado,
 * o seletor de roda do iOS e o VoiceOver continuam os nativos, porque o
 * elemento continua sendo um <select>.
 */
export function Controle({
  icone,
  seta = false,
  children,
}: {
  icone: ReactNode;
  seta?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-roxo pointer-events-none flex">
        {icone}
      </span>
      {children}
      {seta && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-txt-3 pointer-events-none flex">
          <IconeSeta />
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Exportar as duas novidades**

Em `web/ui/src/index.ts`, acrescente `CONTROLE_SELECT` à linha do `Campo` e `IconeSeta` ao bloco de ícones:

```ts
export { Campo, CONTROLE, CONTROLE_INVALIDO, CONTROLE_SELECT } from "./Campo";
```

e, dentro do `export { ... } from "./Icone"`, acrescente `IconeSeta,` junto dos outros.

- [ ] **Step 7: Atualizar os três pontos de uso**

Os três seguem o mesmo padrão: trocar `${CONTROLE} pl-11` por `CONTROLE_SELECT` e acrescentar `seta` ao `Controle`. Ajuste os imports em cada arquivo (`CONTROLE` pode deixar de ser usado — se deixar, remova-o do import; se o arquivo ainda usa `CONTROLE` para um `<input>`, mantenha os dois).

Em `web/admin/src/componentes/SeletorTaxonomia.tsx`:

```tsx
      <Controle icone={<Icone />} seta>
        <select
          id={id}
          className={`${CONTROLE_SELECT} ${erro ? CONTROLE_INVALIDO : ""}`}
```

Em `web/admin/src/app/page.tsx`:

```tsx
            <Controle icone={<IconeSituacao />} seta>
              <select
                id="filtro-situacao"
                className={CONTROLE_SELECT}
```

Em `web/admin/src/app/questoes/editar/page.tsx`:

```tsx
                <Controle icone={<IconeTipo />} seta>
                  <select
                    id="tipo"
                    className={CONTROLE_SELECT}
```

- [ ] **Step 8: Rodar o teste e o typecheck**

Run: `cd web && npm run typecheck && npm run test -w admin -- visual.spec.ts`
Expected: PASSA nos dois navegadores, inclusive o teste do padding no WebKit — que é a prova de que o bug morreu. Se ele continuar em `0px` no WebKit, `appearance-none` não chegou ao elemento: confira se o `<select>` está usando `CONTROLE_SELECT` e não o `CONTROLE` antigo.

- [ ] **Step 9: Rodar a suíte e2e inteira**

Run: `cd web && npm run test -w admin`
Expected: tudo verde. Se algum spec quebrar por causa da seta, é porque conta `svg` em algum lugar — conserte lá, com o mesmo raciocínio do Step 1.

- [ ] **Step 10: Conferir a olho, nos dois navegadores**

O teste do WebKit já cobre o sintoma original, então este passo não é mais a única rede — mas continua valendo por uma razão que nenhum teste cobre: a **seta é nova**, e ninguém nunca a viu. Alinhamento vertical, distância da borda e contraste são coisas que `toHaveCSS` não julga.

Suba `cd web && npm run dev` e abra `http://localhost:3000` no Safari e no Chrome. Nos três selects (Situação na listagem, Tipo e Assunto/Banca no editor), confirme que a seta está centrada na vertical, que não encosta no texto da opção mais longa, e que o texto não encosta no ícone da esquerda.

- [ ] **Step 11: Commit**

```bash
git add web/ui/src/Campo.tsx web/ui/src/Controle.tsx web/ui/src/Icone.tsx \
        web/ui/src/index.ts web/admin/src/componentes/SeletorTaxonomia.tsx \
        web/admin/src/app/page.tsx web/admin/src/app/questoes/editar/page.tsx \
        web/admin/e2e/visual.spec.ts
git commit -m "fix(web): ícone e texto sobrepostos nos select do Safari

O Safari descarta o padding declarado pelo autor enquanto a aparência
nativa do <select> estiver ligada. Confirmado no inspetor:
padding-left computado em 0px com .pl-11 presente na cascata. O ícone
fica em left-3.5 e o texto começava na borda, em cima dele.

appearance-none resolve, e traz junto a remoção da seta nativa — daí a
seta passar a ser desenhada por nós, em todos os navegadores. É
mudança visual no Chrome também, e foi decidida assim para não
depender de detecção de navegador.

O comentário do Controle.tsx argumentava contra isto alegando teclado e
o seletor de roda do iOS. Estava errado: appearance:none muda só o
desenho, o elemento continua sendo um <select> e o comportamento
nativo é o mesmo. Corrigido junto, porque era o que faria alguém
reverter a correção.

Cobertura: o teste mede o padding computado do select e roda nos dois
navegadores. No chromium ele sempre passou; no WebKit ele falhava com
0px antes desta correção, que é exatamente o bug relatado."
```

---

### Task 4: Ano passa a ser obrigatório

**Files:**
- Modify: `api/src/routes/admin/questions.ts:62`
- Modify: `api/src/db/questions.ts:22`
- Modify: `web/admin/src/lib/api.ts:105`
- Modify: `web/admin/src/lib/validacao.ts:74-77`
- Modify: `web/admin/src/app/questoes/editar/page.tsx:281`
- Test: `api/test/admin-questions.test.ts`, `web/admin/e2e/validacao.spec.ts`, `web/admin/e2e/editor.spec.ts`, `web/admin/e2e/caminho-critico.spec.ts`

**Interfaces:**
- Consumes: nada da Task 3 (compartilham `editar/page.tsx`, mas em campos diferentes).
- Produces: `QuestionInput.year` passa de `year?: number | null` para `year: number`. A Task 5 mexe no mesmo `QuestionInput` e no mesmo schema Zod, no campo `explanation` — aplique a Task 5 depois desta e some as mudanças.

**Cuidado que decide esta task.** Existem dois `year` no código e eles não têm a mesma regra. O de **escrita** (`questionSchema`, corpo do POST/PATCH) passa a ser obrigatório. O de **filtro de listagem** (`?year=` na query, tratado em `questions.ts:154-163`) continua opcional, e os testes de `admin-questions.test.ts:302-380` que cobrem `year=ontem`, `year=1500`, `year=` e `year=%20` **são do filtro** — não os toque.

- [ ] **Step 1: Escrever o teste que falha**

Em `api/test/admin-questions.test.ts`, junto dos demais testes de criação, acrescente:

```ts
it("400 ao criar questão sem year — o ano é obrigatório", async () => {
  const { year: _ignorado, ...semAno } = await payload();

  const res = await app().request("/admin/questions", post(semAno), env);

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_request" });
});
```

Os helpers `payload(over)` e `post(body)` estão no topo do arquivo (linhas ~54 e ~72); `payload()` já devolve `year: 2024`, e é por isso que o teste o desestrutura para fora. Reprovação do schema Zod é 400 com `invalid_request` (`questions.ts:182`), não 422 — o 422 é reservado para violação de regra de negócio.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/admin-questions.test.ts -t "o ano é obrigatório"`
Expected: FALHA — hoje o `year` é `nullish`, então a criação sem ano é aceita e o status volta 201.

- [ ] **Step 3: Tornar o `year` obrigatório no schema de escrita**

Em `api/src/routes/admin/questions.ts`, no `questionSchema`, troque a linha do `year`:

```ts
  // Obrigatório desde 2026-08-17, a pedido do cliente. Não confundir com o
  // filtro `?year=` da listagem, que continua opcional — são duas regras
  // diferentes sobre o mesmo nome.
  year: z.number().int().min(MIN_YEAR).max(MAX_YEAR),
```

- [ ] **Step 4: Acompanhar o tipo na camada de persistência**

Em `api/src/db/questions.ts`, na interface `QuestionInput`:

```ts
  year: number;
```

(`QuestionDetail.year` continua `number | null` — ela descreve o que sai do banco, e a coluna permanece nullable.)

- [ ] **Step 5: Rodar o teste novo e a suíte inteira**

Run: `cd api && npx vitest run && npx tsc --noEmit`
Expected: o teste novo passa. **Outros testes provavelmente falham** — todo teste que cria questão sem `year` passa a ser inválido. Conserte cada um acrescentando `year` ao corpo, e não relaxando o schema. O helper `payload()` já manda `year: 2024`, então a maioria deve passar sem mexer.

- [ ] **Step 6: Commit da parte do servidor**

```bash
git add api/src/routes/admin/questions.ts api/src/db/questions.ts api/test/admin-questions.test.ts
git commit -m "feat(api): ano obrigatório na criação e edição de questão

Pedido do cliente. O filtro ?year= da listagem continua opcional — são
duas regras diferentes sobre o mesmo nome, e os testes do filtro em
admin-questions.test.ts não mudam.

Sem migração: o acervo de produção está vazio e a coluna year segue
nullable, porque QuestionDetail descreve o que sai do banco, não o que
entra."
```

- [ ] **Step 7: Escrever o teste de cliente que falha**

Em `web/admin/e2e/validacao.spec.ts`, acrescente um caso ao final dos testes de `validarQuestao`:

```ts
test.describe("validarQuestao: ano", () => {
  test("vazio é erro — o ano é obrigatório", () => {
    const erros = validarQuestao({ ...BASE, ano: "" });
    expect(erros.ano).toBe("Informe o ano da questão.");
  });

  test("fora do intervalo continua sendo erro", () => {
    const erros = validarQuestao({ ...BASE, ano: "1800" });
    expect(erros.ano).toBe("Use um ano entre 1900 e 2200.");
  });
});
```

E **troque a base**, que hoje tem `ano: ""` e passaria a invalidar todos os outros casos do arquivo:

```ts
const BASE = {
  enunciado: "<p>Enunciado.</p>",
  subjectId: "s1",
  bancaId: "b1",
  ano: "2024",
  gabarito: "<p>Gabarito.</p>",
  videoUrl: "",
  alternativas: [
    { body: "A", isCorrect: true },
    { body: "B", isCorrect: false },
  ],
};
```

- [ ] **Step 8: Rodar e ver falhar**

Run: `cd web && npm run test -w admin -- validacao.spec.ts`
Expected: FALHA no caso "vazio é erro" — `erros.ano` volta `undefined`, porque a validação de hoje só checa o intervalo quando o campo está preenchido.

- [ ] **Step 9: Exigir o ano na validação de cliente**

Em `web/admin/src/lib/validacao.ts`, substitua o bloco do ano:

```ts
  // `vazio()` não serve aqui: ele existe para HTML de editor rico, remove
  // tags e trata <img> como conteúdo. O ano é texto puro vindo de um input
  // que já filtra não-dígitos (editar/page.tsx:289).
  if (!entrada.ano.trim()) {
    erros.ano = "Informe o ano da questão.";
  } else {
    const n = Number(entrada.ano);
    if (n < 1900 || n > 2200) erros.ano = "Use um ano entre 1900 e 2200.";
  }
```

- [ ] **Step 10: Trocar a dica na tela**

Em `web/admin/src/app/questoes/editar/page.tsx`, no `Campo` do Ano, remova a dica de opcional:

```tsx
              <Campo rotulo="Ano" htmlFor="ano" erro={erros.ano}>
```

- [ ] **Step 11: Acompanhar o tipo do cliente HTTP**

Em `web/admin/src/lib/api.ts`, no tipo do corpo de escrita (linha ~105), `year?: number | null` passa a `year: number`.

- [ ] **Step 12: Preencher o Ano nos e2e que salvam questão**

Estes specs preenchem o formulário e salvam; sem ano, passam a ser barrados pela validação. Acrescente `await page.getByLabel("Ano").fill("2024");` junto dos outros preenchimentos, **antes** do clique em salvar:

- `web/admin/e2e/validacao.spec.ts`, o caso que termina em `Salvar rascunho` e espera a URL `/` (por volta da linha 110)
- `web/admin/e2e/editor.spec.ts`, os três que salvam (por volta das linhas 79, 105 e 128)
- `web/admin/e2e/caminho-critico.spec.ts`, os dois que ainda não preenchem (por volta das linhas 66 e 147 — o de linha 38 já preenche)

`web/admin/e2e/preview.spec.ts` **não** precisa: ele só pré-visualiza, nunca salva.

- [ ] **Step 13: Rodar tudo**

Run: `cd web && npm run typecheck && npm run test -w admin`
Expected: tudo verde. Qualquer spec que ainda falhe por "Informe o ano" é um que ficou de fora do Step 12.

- [ ] **Step 14: Commit da parte do cliente**

```bash
git add web/admin/src/lib/validacao.ts web/admin/src/lib/api.ts \
        web/admin/src/app/questoes/editar/page.tsx web/admin/e2e/
git commit -m "feat(web): ano obrigatório no editor de questão

Acompanha a validação do servidor. A base dos testes de validarQuestao
tinha ano vazio e passou a 2024, senão todo caso do arquivo começaria
inválido por um campo que ele não está testando.

Os e2e que salvam questão passaram a preencher o Ano. O de
pré-visualização não, porque ele nunca salva."
```

---

### Task 5: Gabarito comentado passa a ser opcional

**Files:**
- Modify: `api/src/routes/admin/questions.ts:63-70`
- Modify: `api/src/db/questions.ts:24` e `:100-131` (`writeChildren`)
- Modify: `web/admin/src/lib/api.ts:107`
- Modify: `web/admin/src/lib/validacao.ts:66-70`
- Modify: `web/admin/src/app/questoes/editar/page.tsx:130` e `:316`
- Test: `api/test/questions-db.test.ts`, `api/test/admin-questions.test.ts`, `web/admin/e2e/validacao.spec.ts`

**Interfaces:**
- Consumes: `QuestionInput` como a Task 4 a deixou (`year: number`).
- Produces: `QuestionInput.explanation` passa de `{ body: string; videoUrl?: string | null }` para `{ body: string; videoUrl?: string | null } | undefined` (campo opcional). `QuestionDetail.explanation` **não muda** — já é `| null`.

**A decisão que governa esta task.** Gabarito ausente **não grava linha** em `explanations`. Não é string vazia. A coluna `body` continua `NOT NULL` e está certa: a ausência é representada pela ausência da linha. Consequência que o código precisa honrar: numa **edição** que apaga um gabarito que existia, a linha tem de ser **removida**, não atualizada para vazio.

- [ ] **Step 1: Escrever os dois testes que falham**

Em `api/test/questions-db.test.ts`, junto dos testes de criação e atualização (use o helper de entrada do topo do arquivo, por volta da linha 38, como modelo):

```ts
it("questão sem explanation não cria linha em explanations", async () => {
  const { explanation: _fora, ...semGabarito } = await baseInput();

  const res = await createQuestion(db(), semGabarito, null);

  const id = (res as { id: string }).id;
  expect(await getQuestion(db(), id).then((d) => d?.explanation)).toBeNull();
});

it("editar apagando o gabarito remove a linha que existia", async () => {
  const res = await createQuestion(db(), await baseInput(), null);
  const id = (res as { id: string }).id;
  expect((await getQuestion(db(), id))?.explanation?.body).toBe(
    "<p>Porque sim</p>",
  );

  const { explanation: _fora, ...semGabarito } = await baseInput();
  await updateQuestion(db(), id, semGabarito);

  expect((await getQuestion(db(), id))?.explanation).toBeNull();
});
```

Assinaturas, para você não errar a aridade: `baseInput(over?)` é assíncrono e já devolve `explanation: { body: "<p>Porque sim</p>" }` (linha ~27); `createQuestion(db, input, createdBy, status?)` recebe **três** argumentos obrigatórios e devolve `{ id } | Failure`; `updateQuestion(db, id, input)`; `getQuestion(db, id)`. O `db()` é função, não variável.

Note que `baseInput()` cria taxonomias novas a cada chamada — chamá-lo duas vezes no segundo teste é intencional e inofensivo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run test/questions-db.test.ts`
Expected: FALHA na compilação ou na execução — `QuestionInput.explanation` é obrigatório hoje, então omitir o campo não passa nem no TypeScript.

- [ ] **Step 3: Tornar `explanation` opcional no schema de escrita**

Em `api/src/routes/admin/questions.ts`, no `questionSchema`:

```ts
  // Opcional desde 2026-08-17, a pedido do cliente. Ausente significa
  // ausente: writeChildren não grava linha em `explanations`, e a coluna
  // body continua NOT NULL porque a ausência é a ausência da linha, não uma
  // string vazia guardada.
  explanation: z
    .object({
      body: z.string().min(1),
      videoUrl: z
        .string()
        .refine(isHttpUrl, { message: "videoUrl precisa ser http ou https" })
        .nullish(),
    })
    .optional(),
```

- [ ] **Step 4: Acompanhar o tipo de entrada**

Em `api/src/db/questions.ts`, na interface `QuestionInput`:

```ts
  explanation?: { body: string; videoUrl?: string | null };
```

- [ ] **Step 5: Fazer o `writeChildren` apagar quando não houver gabarito**

Em `api/src/db/questions.ts`, dentro de `writeChildren`, substitua o trecho que hoje sanitiza e faz upsert incondicional. O `sanitizeHtml` só deve rodar quando há corpo, e o `batch` recebe uma operação diferente conforme o caso:

```ts
  const altBodies = await Promise.all(
    input.alternatives.map((alt) => sanitizeHtml(alt.body)),
  );

  // Sem gabarito, a linha é REMOVIDA, não atualizada para vazio. É o que
  // mantém "sem gabarito" e "gabarito vazio" sendo a mesma coisa — e é o que
  // faz uma edição que apaga o gabarito de fato apagá-lo, em vez de deixar
  // uma explicação que existe e não explica.
  const explanationRow = input.explanation
    ? {
        body: await sanitizeHtml(input.explanation.body),
        videoUrl: input.explanation.videoUrl ?? null,
      }
    : null;

  await db.batch([
    db.delete(alternatives).where(eq(alternatives.questionId, questionId)),
    ...input.alternatives.map((alt, position) =>
      db.insert(alternatives).values({
        id: crypto.randomUUID(),
        questionId,
        position,
        body: altBodies[position],
        isCorrect: alt.isCorrect ? 1 : 0,
      }),
    ),
    explanationRow
      ? db
          .insert(explanations)
          .values({ questionId, ...explanationRow })
          .onConflictDoUpdate({
            target: explanations.questionId,
            set: explanationRow,
          })
      : db.delete(explanations).where(eq(explanations.questionId, questionId)),
  ]);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd api && npx vitest run && npx tsc --noEmit`
Expected: os dois testes novos passam e a suíte inteira segue verde. `db.batch` exige um array não vazio de statements — ele continua tendo pelo menos o `delete` das alternativas, então não há caso degenerado.

- [ ] **Step 7: Commit da parte do servidor**

```bash
git add api/src/routes/admin/questions.ts api/src/db/questions.ts api/test/questions-db.test.ts
git commit -m "feat(api): gabarito comentado passa a ser opcional

Pedido do cliente. Ausente significa ausente: writeChildren não grava
linha em explanations, e numa edição que apaga o gabarito a linha
existente é removida — não atualizada para vazio.

Por isso não há migração. A coluna body continua NOT NULL e está certa
assim: quem representa a ausência é a ausência da linha. QuestionDetail
já devolvia explanation como nullable, então o caminho de leitura não
mudou."
```

- [ ] **Step 8: Escrever o teste de cliente que falha**

Em `web/admin/e2e/validacao.spec.ts`:

```ts
test.describe("validarQuestao: gabarito", () => {
  test("vazio não é erro — o gabarito é opcional", () => {
    const erros = validarQuestao({ ...BASE, gabarito: "" });
    expect(erros.gabarito).toBeUndefined();
  });
});
```

- [ ] **Step 9: Rodar e ver falhar**

Run: `cd web && npm run test -w admin -- validacao.spec.ts`
Expected: FALHA — hoje `validarQuestao` devolve "Escreva o gabarito comentado."

- [ ] **Step 10: Remover a exigência na validação de cliente**

Em `web/admin/src/lib/validacao.ts`, apague o bloco inteiro do gabarito (o `if (vazio(entrada.gabarito))` e o comentário de duas linhas acima dele, que hoje explica por que era obrigatório e passa a estar errado).

Mantenha `entrada.gabarito` na assinatura de `validarQuestao` — a validação de `videoUrl` continua existindo e a tela continua passando o campo.

- [ ] **Step 11: Não enviar `explanation` quando o gabarito estiver vazio**

Em `web/admin/src/app/questoes/editar/page.tsx`, no objeto montado para envio (por volta da linha 130), o campo passa a ser condicional:

```tsx
      ...(gabarito.trim()
        ? { explanation: { body: gabarito, videoUrl: videoUrl || null } }
        : {}),
```

Se o `videoUrl` estiver preenchido e o gabarito não, o vídeo é descartado junto — e isso é correto: o schema do servidor exige `body` quando `explanation` existe, então não há como mandar só o vídeo.

- [ ] **Step 12: Trocar a dica na tela**

No `Campo` do Gabarito comentado (por volta da linha 316):

```tsx
            <Campo rotulo="Gabarito comentado" dica="Opcional" erro={erros.gabarito}>
```

- [ ] **Step 13: Acompanhar o tipo do cliente HTTP**

Em `web/admin/src/lib/api.ts` (linha ~107), o campo de escrita passa a `explanation?: { body: string; videoUrl?: string | null };`.

- [ ] **Step 14: Rodar tudo, dos dois lados**

Run: `cd api && npx vitest run && npx tsc --noEmit`
Run: `cd web && npm run typecheck && npm run test -w admin`
Expected: tudo verde nos dois.

- [ ] **Step 15: Commit da parte do cliente**

```bash
git add web/admin/src/lib/validacao.ts web/admin/src/lib/api.ts \
        web/admin/src/app/questoes/editar/page.tsx web/admin/e2e/validacao.spec.ts
git commit -m "feat(web): gabarito comentado opcional no editor

O campo some do payload quando está vazio, em vez de ir como string
vazia — é o que faz o servidor não gravar a linha. Vídeo sem gabarito é
descartado junto, porque o schema exige body quando explanation existe."
```

---

## Verificação final

- [ ] `cd api && npx vitest run` — verde, com os testes novos das Tasks 4 e 5
- [ ] `cd api && npx tsc --noEmit` — limpo
- [ ] `cd web && npm run typecheck` — limpo
- [ ] `cd web && npm run test -w admin` — verde nos **dois** projetos, chromium e webkit
- [ ] `npx playwright show-report` — conferir que o webkit realmente rodou, e não foi pulado em silêncio
- [ ] Safari e Chrome, à olho: a seta nova centrada e sem encostar no texto
- [ ] Login à mão: o widget do Turnstile aparece claro, mesmo com o macOS no escuro
- [ ] Se a Task 2 catalogou falhas de WebKit alheias à rodada, elas estão reportadas ao dono e **não** foram consertadas por conta própria

## O que este plano deliberadamente não faz

| Item | Por quê |
|---|---|
| Email fixo no login vindo do Access | O dono adiou para conversa própria. Mexe no modelo de identidade e no `/auth/login`, que o sub-projeto 4 vai herdar |
| Dark theme | Decidido não fazer. A Task 1 fixa o claro justamente por isso |
| Consertar falhas de WebKit alheias a esta rodada | A Task 2 as cataloga e reporta. Consertar bug de Safari desconhecido é escopo que ninguém aprovou |
| Alinhar `DISPUTE`/`PROTEST` e `CANCELED`/`EXPIRED` | Divergências de rótulo de auditoria achadas na conferência dos payloads. Não afetam acesso; ficaram para uma próxima rodada |

## Estado da execução — 2026-08-17

Entregues: **Tasks 1, 4 e 5**. Paradas: **Tasks 2 e 3**.

### Por que as Tasks 2 e 3 pararam

O binário do WebKit foi instalado e o projeto Playwright acrescentado. A
primeira rodada revelou o que ninguém sabia: **chromium 100% verde, WebKit com
35 falhas**. Distribuição por spec:

| Spec | Falhas |
|---|---|
| `caminho-critico` | 11 |
| `editor` | 6 |
| `lista` | 5 |
| `visual` | 4 |
| `taxonomias` | 3 |
| `validacao` | 3 |
| `login` | 2 |
| `preview` | 1 |

Duas amostras lidas antes de o catálogo detalhado se perder: `login.spec.ts`
parando na tela de login, e `visual.spec.ts:77` falhando **depois** do login,
num `toHaveCount` de `svg` que volta 0. Ou seja: **há mais de uma causa**, e a
hipótese inicial (o cookie de sessão em `api/src/lib/cookies.ts:8` é `secure:
true`, e o WebKit recusa cookie `Secure` sobre `http://localhost`, ao contrário
do Chromium) explica no máximo parte do conjunto.

A Task 3 depende disto porque o teste que ela precisa escrever mora justamente
em `visual.spec.ts`, e roda no navegador que está vermelho.

A mudança de configuração foi **revertida** — comitar uma config que deixa a
suíte vermelha é pior que não comitar. Ela está preservada fora do versionamento
e é trivial de refazer: acrescentar um projeto `webkit` com
`{ ...devices["Desktop Safari"] }` ao lado do `chromium` em
`web/admin/e2e/playwright.config.ts`, sem tocar em `workers: 1` nem em
`fullyParallel: false`.

Para regenerar o catálogo: refazer a config e rodar
`cd web && npm run test -w admin -- --project=webkit`.

### As saídas possíveis, e por que nenhuma foi tomada

| Saída | Por que depende do dono |
|---|---|
| Tornar `secure` condicional ao protocolo em `cookies.ts` | Altera código sensível a segurança para acomodar teste |
| Servir o dev em HTTPS (`next dev --experimental-https`) | Muda o ferramental de desenvolvimento de todo mundo |
| Recortar o WebKit a um subconjunto de specs | Entrega menos cobertura do que foi pedido |

### Achado colateral, que não é de teste

`editor.spec.ts` ("upload de imagem") é instável **também no chromium**. A causa
não é flutuação: `MEDIA_PUBLIC_BASE` aponta para o domínio de **produção**
(`api/wrangler.jsonc`), então o teste afirma a visibilidade de uma imagem que o
navegador precisa buscar num host remoto onde o objeto recém-enviado ao R2
local não existe. É o item que a rodada de ajustes tinha registrado como "e2e do
upload depende de `MEDIA_PUBLIC_BASE` real" — agora com diagnóstico. Sai da
instabilidade apontando a base para um host local em dev, ou afirmando o `src`
do `<img>` em vez da visibilidade.
