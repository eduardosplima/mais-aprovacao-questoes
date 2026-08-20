# Ajustes finos do painel — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a dívida que a rodada anterior deixou registrada, corrigir o alinhamento do botão "Adicionar" de taxonomias, dar um favicon ao painel — e, antes de tudo isso, provar a linha de base da rodada anterior.

**Architecture:** Nenhuma arquitetura nova. Três props no `Modal` do `web/ui`, um estado novo no `Campo`, um ícone novo, edições pontuais no `ModalTrocarSenha` e em duas telas, e um PNG gerado a partir da logo que já existe. A suíte e2e é a única do painel e é onde tudo se prova.

**Tech Stack:** Next.js 16 (App Router, `output: 'export'`), React 19, Tailwind v4, Playwright (chromium + WebKit), TypeScript.

**Spec:** [`docs/superpowers/specs/2026-08-19-ajustes-finos-design.md`](../specs/2026-08-19-ajustes-finos-design.md)

> **Verificação final executada em 2026-08-19**, depois da onda de correções
> que fechou os três Important da revisão final da branch. Os quatro comandos
> rodaram em sequência e em primeiro plano, nunca concorrentes — o `wrangler
> dev` que o Playwright sobe e o vitest do `api/` abrem o mesmo SQLite do D1
> local.
>
> - Suíte do painel: **verde**, `186` testes (93 em cada navegador), 8.2min.
> - Suíte da API: **verde**, `371` testes em 33 arquivos, 14.4s.
> - `npm run typecheck`: limpo em `ui`, `admin` e `admin/e2e`.
> - `npm run build`: limpo, com `admin/out/icon.png` e o `<link rel="icon">`
>   gerados pela convenção do App Router.
> - Os oito critérios do §11 da spec: conferidos um a um. O critério 6 ("o
>   favicon aparece na aba") foi conferido na saída do build, que é onde a §10
>   da própria spec manda conferi-lo — não numa aba de navegador.
>
> **A primeira tentativa desta verificação foi vermelha, e o registro é dela
> também:** 183/184, `[webkit] taxonomias.spec.ts:78`, timeout de `page.goto`
> — a 7ª ocorrência em 7 execuções completas da suíte desde que ela cresceu de
> 152 para 184 testes. A causa era o `reuseExistingServer: !process.env.CI` do
> `playwright.config.ts`: localmente sempre `true`, ele fazia cada `npm test`
> herdar o `next dev` e o `wrangler dev` da execução anterior, e os dois
> degradam com o tempo de vida acumulado — o WebKit é o único dos dois motores
> que converte essa degradação em timeout duro. Com `reuseExistingServer:
> false` nos dois servidores, a suíte ficou verde em duas execuções completas
> seguidas. Nada foi mascarado: nem retry no projeto webkit, nem timeout maior.
>
> **A conferência a olho aconteceu em 2026-08-20**, feita pelo dono, no
> **Firefox**, contra o roteiro de 21 itens que cobre login, cabeçalho, modal
> de senha, taxonomias, paginação e editor. Ela ficou sem marca por um dia
> justamente porque pede olhos humanos: cada coisa que ela lista está provada
> por teste automatizado ou pela saída do build, mas "parece certo na tela" não
> é coisa que suíte alguma responde.
>
> O navegador fica registrado porque importa aqui: a suíte e2e roda em chromium
> e WebKit, e o Firefox não é exercitado por ela — esta conferência é a única
> passada que o painel teve nesse motor.
>
> **Três marcas com ressalva, para não valerem mais do que aparentam:**
>
> - **Task 7, Step 3** foi implementado, mas não como o plano escreveu: o
>   booleano `descartada` não tem identidade por requisição, e o ruling da
>   revisão o trocou pelo contador `idRequisicao`, que é o padrão já usado em
>   `app/taxonomias/page.tsx` e `app/page.tsx`.
> - **Task 8, Step 3** partiu de uma referência morta (o plano manda pendurar a
>   marca nova em `descartada`, que a Task 7 já tinha eliminado); foi corrigida
>   no despacho.
> - **Task 13, Step 4** saiu com a contagem corrigida por ruling — fecharam
>   **dez** entradas do ledger, e o commit do plano dizia "nove".
>
> A onda de correções que veio depois destas 13 tarefas não está no plano, por
> ser posterior a ele: subseção "Diálogos" no `web/README.md`, o `catch` de
> `renomear()` separando erro com campo culpado de erro sem, o cabeçalho do
> `Campo` atualizado, o caso de temporização de `senha.spec.ts` reescrito de
> forma determinística, e o `reuseExistingServer` acima.

## Global Constraints

- **Nenhum pacote npm novo.** Nem dependência, nem devDependency, nem `npx` de pacote que não esteja no `package.json`. Regra do `~/.claude/CLAUDE.md` §5. O favicon é gerado com o `magick` (`/opt/homebrew/bin/magick`) ou o `sips`, que já estão na máquina — nada é baixado.
- **A Task 1 roda antes de qualquer edição de código.** É a linha de base da rodada anterior, e o motivo dela existir se perde se qualquer arquivo desta rodada for tocado antes.
- **As duas suítes do repositório não rodam juntas.** O `wrangler dev` que o Playwright sobe abre o mesmo SQLite do D1 local (`api/.wrangler/state`) que o vitest do `api/` usa. Rodar em sequência; a disputa derruba testes do painel com cara de defeito de produto.
- **A suíte e2e roda em chromium e WebKit.** `cd web && npm test` sobe os dois servidores sozinho. Um caso que passa só num navegador não está pronto.
- **Código e comentários em português**, comentário explicando *por quê* e não *o quê* — é o padrão de todo o repositório.
- **Mensagem de commit em português**, com o trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **`npm run typecheck` em `web/` cobre os dois workspaces** e precisa ficar limpo ao fim de cada tarefa que toca `.tsx`.
- **O `logo.png` não é alterado**, e as duas telas que o usam (`Layout.tsx`, `login/page.tsx`) também não, exceto pela troca de texto da Task 6.

---

## Task 1: A linha de base da rodada anterior

Esta tarefa não escreve código. Ela prova o estado em que a árvore está **antes** desta rodada, para que qualquer vermelho do fim seja atribuível.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-19-ajustes-painel.md` (checkboxes)

**Interfaces:**
- Consumes: nada.
- Produces: a garantia, para todas as tarefas seguintes, de que a suíte estava verde em `a542f23`.

- [x] **Step 1: Confirmar que a árvore está limpa e no commit esperado**

```bash
git status --short
git log --oneline -1
```

Esperado: nenhuma saída do `status`; o `log` mostra `4abb173` (a spec) ou `a542f23` se a spec ainda não estiver commitada. Se houver arquivo modificado, **pare** — a linha de base precisa ser do código publicado, não de trabalho em voo.

- [x] **Step 2: Rodar a suíte do painel, nos dois navegadores**

```bash
cd web && npm test
```

Esperado: verde. A suíte sobe os dois servidores sozinha (Next com TLS e `wrangler dev`) e roda em chromium e WebKit.

Anote o número de testes por navegador — ele entra no registro do Step 5.

- [x] **Step 3: Rodar a suíte da API, em sequência**

Só depois que o comando anterior terminou e devolveu o prompt. Rodar junto faz os dois disputarem `api/.wrangler/state`.

```bash
cd api && npm test
```

Esperado: verde.

- [x] **Step 4: Conferir os sete critérios de pronto da spec anterior**

Abrir `docs/superpowers/specs/2026-08-19-ajustes-painel-design.md`, seção §9, e conferir um a um contra o que existe hoje. Os sete, resumidos:

1. As duas regras escritas no `web/README.md` — conferir que a seção "Regras de design system" está lá.
2. Login e trocar senha não acionam validação nativa — conferir `noValidate` em `login/page.tsx` e em `ModalTrocarSenha.tsx`, e `aria-required` no lugar de `required`.
3. Trocar senha abre e fecha como modal, sucesso é toast — coberto por `senha.spec.ts`.
4. Cabeçalho e paginação seguem a regra de botões, conferido em 375px — coberto por `visual.spec.ts` e pelos casos de largura de `caminho-critico.spec.ts`.
5. Suíte e2e verde nos dois navegadores — Step 2.
6. `npm run typecheck` limpo nos dois workspaces, incluindo o isolado do `web/ui`:

```bash
cd web && npm run typecheck
```

7. Os dez itens do §7 daquela spec fechados ou registrados como decididos — conferir contra `docs/superpowers/plans/2026-08-07-painel-follow-ups.md`.

**Se algum critério não fechar, pare e relate ao dono.** Corrigir dívida de ontem não é decisão desta rodada.

- [x] **Step 5: Marcar os checkboxes do plano anterior**

Em `docs/superpowers/plans/2026-08-19-ajustes-painel.md`, trocar `- [ ]` por `- [x]` em todos os steps das dez tarefas e na seção "Verificação final" — as dez foram entregues (commits `6acf6a8`..`a15336a`), e o plano registrar isso é o ponto.

Acrescentar, logo abaixo do cabeçalho do arquivo (depois da linha `**Spec:**`), o bloco de registro, com os números reais medidos no Step 2:

```markdown
> **Verificação final executada em 2026-08-19**, no início da rodada de ajustes
> finos e antes de qualquer mudança dela — para que um vermelho posterior não
> ficasse ambíguo entre dívida desta rodada e regressão da seguinte.
>
> - Suíte do painel: verde, chromium e WebKit (`<N>` testes em cada).
> - Suíte da API: verde, rodada em sequência.
> - `npm run typecheck`: limpo nos dois workspaces.
> - Os sete critérios do §9 da spec: conferidos um a um.
```

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-19-ajustes-painel.md
git commit -m "$(cat <<'EOF'
docs: o plano da rodada anterior passa a registrar que foi verificado

As dez tarefas estavam entregues e o plano tinha todos os checkboxes vazios —
um plano que não registra o que aconteceu vira o mesmo passivo que um ledger
não reconferido.

A verificação rodou antes da primeira mudança da rodada seguinte, de propósito:
depois que os dois conjuntos de mudança se misturam, um teste vermelho não
distingue mais dívida de ontem de regressão de hoje.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: O `Modal` ganha ícone nos dois botões

**Files:**
- Modify: `web/ui/src/Modal.tsx`
- Modify: `web/admin/src/app/page.tsx:304-311`
- Modify: `web/admin/src/app/taxonomias/page.tsx:244-282`
- Modify: `web/admin/src/componentes/ModalTrocarSenha.tsx:101-109`
- Test: `web/admin/e2e/visual.spec.ts`, `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: `IconeCancelar`, `IconeSalvar`, `IconeExcluir` de `web/ui/src/Icone.tsx` (já existem).
- Produces: `Modal` passa a aceitar `iconeConfirmar?: ReactNode`. Tasks 3 e 4 editam o mesmo arquivo depois desta.

- [x] **Step 1: Escrever os testes que falham**

Em `web/admin/e2e/visual.spec.ts`, no fim do arquivo:

```ts
test("os botões dos diálogos seguem o padrão de ícone junto do texto", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Vunesp");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Vunesp")).toBeVisible();

  // O diálogo de renomear: confirmar é "Salvar", e leva disquete.
  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Vunesp" })
    .click();
  const renomear = page.getByRole("dialog");
  await expect(
    renomear.getByRole("button", { name: "Cancelar" }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    renomear.getByRole("button", { name: "Salvar" }).locator("svg"),
  ).toHaveCount(1);
  await renomear.getByRole("button", { name: "Cancelar" }).click();

  // O de excluir: confirmar é "Excluir", e leva lixeira — não o mesmo ícone
  // do salvar, que é justamente por isso que o ícone vem do chamador.
  await page
    .locator("table")
    .getByRole("button", { name: "Excluir Vunesp" })
    .click();
  const excluir = page.getByRole("dialog");
  await expect(
    excluir.getByRole("button", { name: "Cancelar" }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    excluir.getByRole("button", { name: "Excluir", exact: true }).locator("svg"),
  ).toHaveCount(1);
});
```

Em `web/admin/e2e/senha.spec.ts`, no fim do arquivo:

```ts
test("os botões do modal de senha têm ícone junto do texto", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);

  await expect(
    modal.getByRole("button", { name: "Cancelar" }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    modal.getByRole("button", { name: "Salvar" }).locator("svg"),
  ).toHaveCount(1);
});
```

Em `web/admin/e2e/lista.spec.ts`, dentro do teste existente que abre o diálogo de excluir questão (por volta da linha 139), logo **antes** do clique no confirmar:

```ts
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("button", { name: "Cancelar" }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    dialogo.getByRole("button", { name: "Excluir", exact: true }).locator("svg"),
  ).toHaveCount(1);
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- visual.spec.ts senha.spec.ts lista.spec.ts
```

Esperado: FALHA nos três, com `Expected: 1, Received: 0` — os botões do `Modal` não têm `svg` nenhum hoje.

- [x] **Step 3: Implementar no `web/ui`**

Em `web/ui/src/Modal.tsx`, o import no topo:

```tsx
import { Botao } from "./Botao";
import { IconeCancelar } from "./Icone";
```

Acrescentar a prop na assinatura, depois de `perigo`:

```tsx
  iconeConfirmar,
```

e no tipo, depois de `perigo?: boolean;`:

```tsx
  /**
   * Ícone do botão de confirmar. Vem do chamador porque `Excluir` e `Salvar`
   * não são a mesma ação e não podem levar o mesmo ícone. O `Cancelar` não
   * tem prop equivalente: cancelar é sempre a mesma coisa, e oferecer a
   * escolha seria inventar uma decisão que não existe.
   *
   * Opcional, e não obrigatória, porque este pacote é consumido de fora: a
   * regra 2 do `web/README.md` é a autoridade sobre ícone em botão, e o tipo
   * não é o lugar de forçá-la.
   */
  iconeConfirmar?: ReactNode;
```

E a linha de botões:

```tsx
        <div className="flex gap-3 justify-end">
          <Botao variante="secundario" onClick={aoCancelar}>
            <IconeCancelar />
            Cancelar
          </Botao>
          <Botao
            variante={perigo ? "perigo" : "primario"}
            carregando={carregando}
            type={idFormulario ? "submit" : "button"}
            form={idFormulario}
            onClick={idFormulario ? undefined : aoConfirmar}
          >
            {iconeConfirmar}
            {rotuloConfirmar}
          </Botao>
        </div>
```

O ícone some junto com o texto quando `carregando` é verdadeiro — o `Botao` troca os `children` inteiros por "Aguarde…", e é o comportamento certo.

- [x] **Step 4: Passar o ícone nos quatro chamadores**

`web/admin/src/app/page.tsx` — acrescentar `IconeExcluir` já está importado; adicionar a prop ao `<Modal>` da linha 304:

```tsx
        rotuloConfirmar="Excluir"
        iconeConfirmar={<IconeExcluir />}
```

`web/admin/src/app/taxonomias/page.tsx` — `IconeExcluir` já está importado; acrescentar `IconeSalvar` à lista de imports de `@mais/ui`, e depois:

```tsx
        rotuloConfirmar="Salvar"
        iconeConfirmar={<IconeSalvar />}
```

no modal de renomear (linha 247), e

```tsx
        rotuloConfirmar="Excluir"
        iconeConfirmar={<IconeExcluir />}
```

no de excluir (linha 278).

`web/admin/src/componentes/ModalTrocarSenha.tsx` — acrescentar `IconeSalvar` ao import de `@mais/ui` e:

```tsx
      rotuloConfirmar="Salvar"
      iconeConfirmar={<IconeSalvar />}
```

- [x] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

Esperado: tudo verde, typecheck limpo.

- [x] **Step 6: Commit**

```bash
git add web/ui/src/Modal.tsx web/admin/src/app/page.tsx web/admin/src/app/taxonomias/page.tsx web/admin/src/componentes/ModalTrocarSenha.tsx web/admin/e2e/visual.spec.ts web/admin/e2e/senha.spec.ts web/admin/e2e/lista.spec.ts
git commit -m "$(cat <<'EOF'
feat(ui): os botões do Modal entram na regra que o próprio README publicou

Eram os últimos contraexemplos dentro do web/ui de uma regra escrita para o
sub-projeto 4 herdar. O Cancelar leva ícone fixo, porque cancelar é sempre a
mesma ação; o confirmar recebe o ícone do chamador, porque Excluir e Salvar
não são a mesma coisa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: O `Modal` ganha `erro`, e excluir termo sai do toast

**Files:**
- Modify: `web/ui/src/Modal.tsx`
- Modify: `web/admin/src/app/taxonomias/page.tsx`
- Test: `web/admin/e2e/taxonomias.spec.ts`

**Interfaces:**
- Consumes: `Modal` da Task 2.
- Produces: `Modal` passa a aceitar `erro?: string`. A Task 7 usa essa prop no `ModalTrocarSenha`.

- [x] **Step 1: Escrever o teste que falha**

Em `web/admin/e2e/taxonomias.spec.ts`, no fim do arquivo:

```ts
// O modal de excluir fica aberto quando a exclusão falha — `aExcluir` só zera
// no sucesso. Mandar a mensagem para o toast, na borda da tela, é falar para
// alguém que está olhando para o centro.
test("a falha ao excluir explica dentro do próprio diálogo", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Cesgranrio");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cesgranrio")).toBeVisible();

  // Corrida real: outra pessoa excluiu o termo antes. Interceptado para ser
  // determinístico.
  await page.route("**/admin/taxonomy/**", async (rota) => {
    if (rota.request().method() === "DELETE") {
      return rota.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return rota.fallback();
  });

  await page
    .locator("table")
    .getByRole("button", { name: "Excluir Cesgranrio" })
    .click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: "Excluir", exact: true }).click();

  await expect(dialogo.getByRole("alert")).toBeVisible();
  await expect(dialogo.getByRole("alert")).toContainText(
    /não encontrado/i,
  );
  // E o diálogo continua aberto, que é a razão de a mensagem morar nele.
  await expect(dialogo).toBeVisible();
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- taxonomias.spec.ts
```

Esperado: FALHA — hoje a mensagem sai em toast, fora do `role="dialog"`, então `dialogo.getByRole("alert")` não encontra nada.

- [x] **Step 3: Implementar a prop no `web/ui`**

Em `web/ui/src/Modal.tsx`, acrescentar `erro` à assinatura (depois de `carregando`) e ao tipo:

```tsx
  /**
   * Erro sem campo responsável, exibido dentro do próprio diálogo. Enquanto
   * há diálogo aberto o erro pertence a ele: toast fica na borda da tela,
   * acima do overlay, e é fácil de não ver com o modal na frente.
   *
   * Quando existe campo culpado — o 409 de renomear, por exemplo — o erro vai
   * no campo, não aqui.
   *
   * `role="alert"` é o papel certo aqui, e não contradiz o `aviso` do Campo:
   * isto é resposta a uma ação que a pessoa acabou de disparar e que falhou,
   * que é exatamente o caso de uso de um alerta assertivo.
   */
  erro?: string;
```

E o corpo, entre o `children` e a linha de botões:

```tsx
        {children && <div className="text-[14.5px] text-txt-2">{children}</div>}
        {erro && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            {erro}
          </p>
        )}
        <div className="flex gap-3 justify-end">
```

- [x] **Step 4: Ligar no excluir termo**

Em `web/admin/src/app/taxonomias/page.tsx`, acrescentar o estado junto dos outros (perto de `erroRenomear`, linha 50):

```tsx
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
```

Na função `excluir()`, trocar o toast pelo estado:

```tsx
  async function excluir() {
    if (!aExcluir) return;
    const alvo = aExcluir;
    setErroExcluir(null);
    setExcluindo(true);
    try {
      await api.excluirTermo(alvo.id);
      setAExcluir(null);
      avisar("Termo excluído.");
      await carregar();
    } catch (falha) {
      // Dentro do diálogo, e não em toast: o modal continua aberto no caminho
      // de falha, então a mensagem precisa estar onde os olhos já estão.
      setErroExcluir(mensagemDe(falha));
    } finally {
      setExcluindo(false);
    }
  }
```

E no `<Modal>` de excluir, passar a prop e limpar ao fechar:

```tsx
        carregando={excluindo}
        erro={erroExcluir ?? undefined}
        aoConfirmar={() => void excluir()}
        aoCancelar={() => {
          setAExcluir(null);
          setErroExcluir(null);
        }}
```

Também limpar ao **abrir**, no `BotaoIcone` da coluna Ações — senão o erro de uma tentativa reaparece na próxima:

```tsx
            onClick={() => {
              setAExcluir(t);
              setErroExcluir(null);
            }}
```

- [x] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

- [x] **Step 6: Commit**

```bash
git add web/ui/src/Modal.tsx web/admin/src/app/taxonomias/page.tsx web/admin/e2e/taxonomias.spec.ts
git commit -m "$(cat <<'EOF'
feat(ui): o erro de um diálogo passa a morar dentro dele

O modal de excluir termo fica aberto quando a exclusão falha — aExcluir só
zera no sucesso —, e a mensagem saía em toast na borda da tela, longe de onde
o operador está olhando.

Excluir questão continua em toast e não é exceção: aquele fluxo fecha o
diálogo antes de chamar a API, então não há modal na frente quando o erro
chega. A regra é ancorada no estado do diálogo, não no nome da ação.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: O backdrop para de fechar

**Files:**
- Modify: `web/ui/src/Modal.tsx`
- Test: `web/admin/e2e/taxonomias.spec.ts`

**Interfaces:**
- Consumes: `Modal` das Tasks 2 e 3.
- Produces: comportamento novo para os quatro diálogos. Nenhuma prop nova.

- [x] **Step 1: Escrever o teste que falha**

Em `web/admin/e2e/taxonomias.spec.ts`, no fim do arquivo:

```ts
// Regra única dos quatro diálogos: o fundo não fecha. O que motivou foi o
// modal de senha, onde um clique por engano descarta três senhas digitadas —
// mas uma prop por chamador obrigaria todo consumidor futuro do web/ui a
// descobrir que ela existe e decidir certo.
test("clicar no fundo escuro não fecha o diálogo; Escape fecha", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Quadrix");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Quadrix")).toBeVisible();

  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Quadrix" })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  // O canto superior esquerdo é fundo: o diálogo é centralizado e tem largura
  // máxima de 28rem.
  await page.mouse.click(5, 5);
  await expect(dialogo).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- taxonomias.spec.ts
```

Esperado: FALHA na primeira asserção depois do clique — hoje o clique no fundo fecha o diálogo.

- [x] **Step 3: Implementar**

Em `web/ui/src/Modal.tsx`, o `div` do fundo perde o `onClick`, e o diálogo perde o `stopPropagation` que existia só por causa dele:

```tsx
  if (!aberto) return null;
  return (
    // O fundo não fecha o diálogo. Um clique fora é acidente com a mesma
    // frequência que é intenção, e no modal de trocar senha o acidente custa
    // três senhas digitadas. Escape e Cancelar continuam sendo as saídas — e
    // Escape é a que leitor de tela anuncia como contrato de diálogo.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md bg-card rounded-card shadow-card-2 p-6 flex flex-col gap-4"
      >
```

O `stopPropagation` sai porque a mudança desta tarefa o deixou órfão — ele impedia que o clique dentro do diálogo subisse até um handler que não existe mais.

- [x] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

Atenção: se algum teste existente fechava um diálogo clicando fora, ele vai falhar aqui — e a correção é trocar o clique por `Escape` ou pelo botão `Cancelar`, não reverter o comportamento.

- [x] **Step 5: Commit**

```bash
git add web/ui/src/Modal.tsx web/admin/e2e/taxonomias.spec.ts
git commit -m "$(cat <<'EOF'
feat(ui): o fundo escuro deixa de fechar os diálogos

Um clique fora é acidente com a mesma frequência que é intenção, e no modal de
trocar senha o acidente custa três senhas digitadas sem desfazer.

Regra única para os quatro diálogos, em vez de prop por chamador: uma prop
obrigaria todo consumidor futuro do web/ui a descobrir que ela existe e a
decidir certo. Escape continua fechando — o descarte deliberado segue
possível, e isso está registrado no ledger.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: O `Campo` ganha `aviso`, e o tip de divergência passa por ele

**Files:**
- Modify: `web/ui/src/Campo.tsx`
- Modify: `web/admin/src/componentes/ModalTrocarSenha.tsx`
- Test: `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: `Campo` como está hoje.
- Produces: `Campo` passa a aceitar `aviso?: string`. Precedência: `erro` > `aviso` > `dica`.

- [x] **Step 1: Escrever o teste que falha**

Em `web/admin/e2e/senha.spec.ts`, no fim do arquivo:

```ts
// O tip ao vivo é aviso de conveniência, não alerta: `role="alert"` é
// assertivo e interrompe o leitor de tela. E o gatilho é ruim — `divergem`
// compara as strings inteiras, então quem digita a confirmação CORRETAMENTE
// dispara a divergência no primeiro caractere e continua "divergente" até a
// última letra. Interromper para afirmar algo que é falso a maior parte do
// tempo é o pior par possível.
test("o tip ao vivo é polido; o erro de envio continua assertivo", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);

  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-compri");

  const tip = modal.getByText("A confirmação não confere.");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute("role", "status");

  // E continua vermelho: o que muda é a etiqueta ARIA, não a aparência.
  await expect(tip).toHaveCSS("color", "rgb(220, 38, 38)");

  // Depois do envio, a mesma frase é erro de verdade e volta a ser alerta.
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByRole("button", { name: "Salvar" }).click();
  await expect(
    modal.getByRole("alert").filter({ hasText: "A confirmação não confere." }),
  ).toBeVisible();
});
```

**Antes de escrever a asserção de cor, medir o valor real** — o token `text-erro` é uma custom property e o `rgb()` acima é o valor esperado, não um chute a manter se a medição divergir:

```bash
cd web && npm run test -w admin -- senha.spec.ts --grep "tip ao vivo"
```

Se falhar na cor, ajustar a asserção para o valor que o navegador reportou. Se falhar no `role`, é o defeito que esta tarefa corrige.

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- senha.spec.ts
```

Esperado: FALHA em `toHaveAttribute("role", "status")` — hoje o tip entra pelo `erro` do `Campo`, que renderiza `role="alert"`.

- [x] **Step 3: Implementar no `web/ui`**

Em `web/ui/src/Campo.tsx`:

```tsx
export function Campo({
  rotulo,
  erro,
  aviso,
  dica,
  htmlFor,
  children,
}: {
  rotulo: string;
  erro?: string;
  /**
   * Mesma aparência do `erro` e etiqueta ARIA diferente: `role="status"` é
   * polido — entra na fila do leitor de tela em vez de interromper o que
   * está sendo falado.
   *
   * Para o aviso que aparece enquanto a pessoa digita, e que ela não pediu.
   * Um erro que responde a uma ação disparada continua sendo `erro`.
   */
  aviso?: string;
  dica?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-txt">
        {rotulo}
      </label>
      {children}
      {dica && !erro && !aviso && (
        <p className="text-[12.5px] text-txt-3">{dica}</p>
      )}
      {aviso && !erro && (
        <p role="status" className="text-[12.5px] font-semibold text-erro">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="text-[12.5px] font-semibold text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
```

- [x] **Step 4: Ligar no `ModalTrocarSenha`**

Em `web/admin/src/componentes/ModalTrocarSenha.tsx`, substituir a linha de `erroConfirmacao` (a que combina os dois) por:

```tsx
  // O erro de envio e o tip ao vivo têm a mesma frase e papéis diferentes: o
  // primeiro responde a uma ação e interrompe; o segundo aparece sozinho e
  // espera a vez.
  const avisoDivergencia =
    !erros.confirmacao && divergem ? "A confirmação não confere." : undefined;
  // O campo está de fato inválido nos dois casos — o aria-invalid e a borda
  // vermelha não distinguem, só a etiqueta do texto distingue.
  const confirmacaoInvalida = Boolean(erros.confirmacao) || divergem;
```

E o `Campo` da confirmação:

```tsx
        <Campo
          rotulo="Confirme a nova senha"
          htmlFor="confirmacao"
          erro={erros.confirmacao}
          aviso={avisoDivergencia}
        >
          <input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={confirmacaoInvalida ? true : undefined}
            className={`${CONTROLE} ${confirmacaoInvalida ? CONTROLE_INVALIDO : ""}`}
```

- [x] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

- [x] **Step 6: Commit**

```bash
git add web/ui/src/Campo.tsx web/admin/src/componentes/ModalTrocarSenha.tsx web/admin/e2e/senha.spec.ts
git commit -m "$(cat <<'EOF'
feat(ui): o aviso que ninguém pediu para de interromper o leitor de tela

O tip de divergência entrava pelo erro do Campo, que é role="alert" —
assertivo. E `divergem` compara as strings inteiras: quem digita a confirmação
corretamente dispara a divergência no primeiro caractere e segue "divergente"
até a última letra. Interromper para afirmar algo falso a maior parte do tempo
é o pior par possível.

O vermelho fica intacto. A primeira proposta era mandar o tip pelo `dica`,
cinza — pagar acessibilidade com visibilidade, num aviso cuja razão de existir
é ser notado enquanto se digita num campo mascarado. Recusada pelo dono.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Login — `IconeEntrar` e o Cloudflare Access por extenso

**Files:**
- Modify: `web/ui/src/Icone.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/app/login/page.tsx:84` e o botão `Entrar`
- Test: `web/admin/e2e/login.spec.ts`

**Interfaces:**
- Consumes: o `Svg` e o `PropsIcone` internos de `Icone.tsx`.
- Produces: `IconeEntrar`, exportado por `@mais/ui`.

- [x] **Step 1: Escrever os testes que falham**

Em `web/admin/e2e/login.spec.ts`, no fim do arquivo:

```ts
test("o botão Entrar tem ícone junto do texto", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);

  await expect(
    page.getByRole("button", { name: "Entrar" }).locator("svg"),
  ).toHaveCount(1);
});

// O rodapé já chamava o produto pelo nome completo, e o corpo da mesma tela
// dizia só "Access" — duas formas do mesmo nome próprio a dez linhas de
// distância, sendo que é o produto que autentica a pessoa.
test("o corpo nomeia o Cloudflare Access por extenso, como o rodapé", async ({
  page,
}) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);

  await expect(
    page.getByText(/Você entrou pelo Cloudflare Access como/),
  ).toBeVisible();
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- login.spec.ts
```

Esperado: FALHA nos dois — não há `svg` no botão, e o texto ainda é "pelo Access".

- [x] **Step 3: Criar o ícone**

Em `web/ui/src/Icone.tsx`, no fim do arquivo (logo depois de `IconeSair`, que é seu espelho):

```tsx
export function IconeEntrar(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </Svg>
  );
}
```

Em `web/ui/src/index.ts`, acrescentar `IconeEntrar` à lista exportada de `./Icone`, logo antes de `IconeSair`.

- [x] **Step 4: Usar no login e trocar o texto**

Em `web/admin/src/app/login/page.tsx`, acrescentar `IconeEntrar` ao import de `@mais/ui`; trocar a linha 84:

```tsx
            Você entrou pelo Cloudflare Access como <strong>{contexto.email}</strong>.
```

e pôr o ícone no botão de submit:

```tsx
              <IconeEntrar />
              Entrar
```

- [x] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

- [x] **Step 6: Commit**

```bash
git add web/ui/src/Icone.tsx web/ui/src/index.ts web/admin/src/app/login/page.tsx web/admin/e2e/login.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): o Entrar ganha ícone, e o Access vira Cloudflare Access no corpo

Era o terceiro e último contraexemplo, dentro do web/ui, da regra de botões
que o README publicou para o sub-projeto 4 herdar.

O texto: a mesma tela dizia "pelo Access" no corpo e "Cloudflare Access" no
rodapé, a dez linhas de distância.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `ModalTrocarSenha` — o erro que sobrevivia ao cancelamento, e o que não limpava

**Files:**
- Modify: `web/admin/src/componentes/ModalTrocarSenha.tsx`
- Test: `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: a prop `erro` do `Modal` (Task 3).
- Produces: nada que outra tarefa consuma.

- [x] **Step 1: Escrever os testes que falham**

Em `web/admin/e2e/senha.spec.ts`, no fim do arquivo:

```ts
// Cancelar com a requisição em voo: fechar() limpa o estado, mas o catch
// escreve depois que ele rodou. As senhas somem e a mensagem de erro fica
// guardada para a próxima abertura.
test("cancelar com a requisição em voo não guarda o erro para a próxima abertura", async ({
  page,
}) => {
  await page.route("**/admin/auth/senha", async (rota) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return rota.fulfill({ status: 400, json: { error: "senha_atual_incorreta" } });
  });

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("qualquer-coisa-comprida");
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();
  await modal.getByRole("button", { name: "Cancelar" }).click();

  // A resposta chega agora, com o modal já fechado.
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Trocar senha" }).click();
  const reaberto = page.getByRole("dialog");
  await expect(reaberto.getByText("Senha atual incorreta.")).toHaveCount(0);
});

// Falha de rede não tem campo culpado, então vira o erro do diálogo. Como os
// erros de campo, ele precisa sair quando a pessoa começa a corrigir — senão
// fica na tela enquanto ela reescreve tudo.
test("o erro geral some ao voltar a digitar", async ({ page }) => {
  await page.route("**/admin/auth/senha", (rota) => rota.abort());

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  const geral = modal.getByRole("alert").filter({ hasText: /não foi possível falar/i });
  await expect(geral).toBeVisible();

  await modal.getByLabel("Senha atual").fill(`${SENHA}x`);
  await expect(geral).toHaveCount(0);
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- senha.spec.ts
```

Esperado: FALHA nos dois — o erro reaparece na reabertura, e o geral não some ao digitar.

- [x] **Step 3: Implementar**

Em `web/admin/src/componentes/ModalTrocarSenha.tsx`, acrescentar o import de `useRef`:

```tsx
import { useRef, useState } from "react";
```

Declarar a marca, junto dos outros estados:

```tsx
  // Cancelar não cancela a requisição que já saiu: o `catch` roda depois que
  // fechar() limpou tudo e reescreve o erro por cima do estado limpo, que
  // então aparece na próxima abertura. A marca faz a resposta tardia ser
  // ignorada em vez de ressuscitar o modal fechado.
  const descartada = useRef(false);
```

Em `fechar()`, marcar:

```tsx
  function fechar() {
    descartada.current = true;
    setAtual("");
    setNova("");
    setConfirmacao("");
    setErros({});
    aoFechar();
  }
```

Em `enviar()`, desmarcar no começo do envio e sair cedo no `catch` e no `finally`:

```tsx
    setErros({});
    setEnviando(true);
    descartada.current = false;
    try {
      await api.trocarSenha(atual, nova);
      avisar("Senha trocada.");
      fechar();
    } catch (falha) {
      if (descartada.current) return;
      // ... (o encaminhamento por código continua como está)
    } finally {
      if (!descartada.current) setEnviando(false);
    }
```

Acrescentar o helper de limpeza do erro geral e chamá-lo nos três `onChange`:

```tsx
  // O erro geral não pertence a nenhum campo, então nenhum `onChange` o
  // limpava — e ele ficava na tela enquanto a pessoa reescrevia tudo.
  function limparGeral() {
    setErros((x) => (x.geral ? { ...x, geral: undefined } : x));
  }
```

Em cada um dos três `onChange`, chamar `limparGeral();` como primeira linha depois do `set` do valor.

Trocar o `<p>` improvisado pela prop do `Modal`: remover o bloco

```tsx
        {erros.geral && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            {erros.geral}
          </p>
        )}
```

e acrescentar ao `<Modal>`:

```tsx
      erro={erros.geral}
```

- [x] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

- [x] **Step 5: Commit**

```bash
git add web/admin/src/componentes/ModalTrocarSenha.tsx web/admin/e2e/senha.spec.ts
git commit -m "$(cat <<'EOF'
fix(web): o erro do modal de senha para de sobreviver ao cancelamento

Cancelar não cancela a requisição que já saiu: o catch rodava depois de
fechar() ter limpado tudo e reescrevia o erro por cima do estado limpo, que
então aparecia na abertura seguinte — as senhas sumiam, a mensagem não.

Junto, o erro geral passa a limpar ao digitar, como os de campo já faziam, e
sai do <p> improvisado para a prop erro do Modal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `ModalTrocarSenha` — a mensagem que culpava o campo errado, e a que sumia cedo

**Files:**
- Modify: `web/admin/src/componentes/ModalTrocarSenha.tsx`
- Test: `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: o `ModalTrocarSenha` como a Task 7 o deixou.
- Produces: nada que outra tarefa consuma.

- [x] **Step 1: Escrever os testes que falham**

Em `web/admin/e2e/senha.spec.ts`, no fim do arquivo:

```ts
// Com a Nova senha vazia, a divergência é consequência, não causa: acusar
// "A confirmação não confere." manda a pessoa olhar para o campo certo pelo
// motivo errado, e o campo que precisa de conteúdo é o de cima.
test("com a Nova senha vazia, o erro é dela — não da confirmação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("Informe a nova senha.")).toBeVisible();
  await expect(modal.getByText("A confirmação não confere.")).toHaveCount(0);
});

// A mensagem do servidor enuncia a regra que a pessoa precisa cumprir, e
// sumia justamente quando ela começava a cumpri-la.
test("a exigência de tamanho do servidor sobrevive à digitação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("curta12345");
  await modal.getByLabel("Confirme a nova senha").fill("curta12345");
  await modal.getByRole("button", { name: "Salvar" }).click();

  const exigencia = modal.getByText(
    "A senha precisa ter pelo menos 12 caracteres.",
  );
  await expect(exigencia).toBeVisible();

  // Digitar mais um caractere não faz a regra desaparecer da tela.
  await modal.getByLabel("Nova senha", { exact: true }).fill("curta123456");
  await expect(exigencia).toBeVisible();
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- senha.spec.ts
```

Esperado: FALHA nos dois — hoje a confirmação é acusada com a nova vazia, e a exigência some no primeiro caractere.

- [x] **Step 3: Implementar**

Em `enviar()`, a validação local: a divergência só é acusada quando a nova tem conteúdo.

```tsx
    const encontrados: Erros = {};
    if (!atual) encontrados.atual = "Informe a senha atual.";
    if (!nova) encontrados.nova = "Informe a nova senha.";
    if (!confirmacao) encontrados.confirmacao = "Confirme a nova senha.";
    // `nova &&` porque com ela vazia a divergência é consequência, não causa:
    // o campo que precisa de conteúdo é o de cima, e é dele que a pessoa
    // precisa ouvir.
    else if (nova && nova !== confirmacao) {
      encontrados.confirmacao = "A confirmação não confere.";
    }
```

Declarar a segunda marca, junto de `descartada`:

```tsx
  // O erro de "Nova senha" tem duas origens: validação local (some ao digitar,
  // porque digitar é o que a corrige) e recusa do servidor, que enuncia a
  // regra a cumprir — essa precisa ficar na tela enquanto a pessoa tenta
  // cumpri-la, e só sai no envio seguinte.
  const novaDoServidor = useRef(false);
```

Em `enviar()`, junto de `descartada.current = false;`:

```tsx
    novaDoServidor.current = false;
```

No `catch`, ao encaminhar o `weak_password`:

```tsx
      } else if (falha instanceof ApiError && falha.codigo === "weak_password") {
        novaDoServidor.current = true;
        setErros({ nova: mensagemDe(falha) });
      } else {
```

No `onChange` de "Nova senha", a limpeza passa a ser condicional:

```tsx
              if (erros.nova && !novaDoServidor.current) {
                setErros((x) => ({ ...x, nova: undefined }));
              }
```

- [x] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

- [x] **Step 5: Commit**

```bash
git add web/admin/src/componentes/ModalTrocarSenha.tsx web/admin/e2e/senha.spec.ts
git commit -m "$(cat <<'EOF'
fix(web): o modal de senha para de culpar a confirmação pelo campo vazio de cima

Com "Nova senha" vazia e "Confirme" preenchida, a divergência é consequência,
não causa — e a mensagem mandava olhar para o campo certo pelo motivo errado.

Junto: a exigência de 12 caracteres vinda do servidor deixa de sumir no
primeiro caractere digitado. Ela enuncia a regra a cumprir, e sumia justamente
quando a pessoa começava a cumpri-la.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: A cobertura que faltava no modal de senha

**Files:**
- Test: `web/admin/e2e/senha.spec.ts`

**Interfaces:**
- Consumes: o `ModalTrocarSenha` como as Tasks 7 e 8 o deixaram.
- Produces: nada. É tarefa só de teste — o comportamento já está certo, e o que falta é a prova.

- [x] **Step 1: Escrever os testes**

Em `web/admin/e2e/senha.spec.ts`, no fim do arquivo:

```ts
// Reabrir precisa mostrar os campos limpos. É comportamento que fechar() já
// tem, e que ninguém provava — se ele se perder num refactor, o vazamento é
// de senha digitada entre duas aberturas.
test("reabrir o modal mostra os três campos limpos", async ({ page }) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("alguma-coisa-comprida");
  await modal.getByLabel("Nova senha", { exact: true }).fill("outra-coisa-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("mais-uma-coisa-comprida");
  await modal.getByRole("button", { name: "Cancelar" }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole("button", { name: "Trocar senha" }).click();
  const reaberto = page.getByRole("dialog");
  await expect(reaberto.getByLabel("Senha atual")).toHaveValue("");
  await expect(reaberto.getByLabel("Nova senha", { exact: true })).toHaveValue("");
  await expect(reaberto.getByLabel("Confirme a nova senha")).toHaveValue("");
});

// O `required` saiu para tirar o balão nativo do navegador; o aria-required
// ficou porque a informação para leitor de tela é legítima e não tem nada a
// ver com a aparência. Sem teste, a segunda metade se perde na primeira vez
// que alguém "limpar" os atributos.
test("os três campos declaram aria-required", async ({ page }) => {
  const modal = await abrirTrocarSenha(page);

  for (const rotulo of ["Senha atual", "Confirme a nova senha"]) {
    await expect(modal.getByLabel(rotulo)).toHaveAttribute("aria-required", "true");
  }
  await expect(
    modal.getByLabel("Nova senha", { exact: true }),
  ).toHaveAttribute("aria-required", "true");
});
```

- [x] **Step 2: Rodar**

```bash
cd web && npm run test -w admin -- senha.spec.ts
```

Esperado: PASSA nos dois. Aqui o teste não falha primeiro de propósito — é cobertura de comportamento que já existe, não correção. Se algum falhar, é defeito real e precisa ser corrigido antes do commit.

Se `aria-required` falhar, conferir o atributo renderizado: `aria-required` sem valor em JSX vira `aria-required="true"` no DOM.

- [x] **Step 3: Rodar nos dois navegadores**

```bash
cd web && npm test
```

- [x] **Step 4: Commit**

```bash
git add web/admin/e2e/senha.spec.ts
git commit -m "$(cat <<'EOF'
test(web): o modal de senha prova que reabre limpo e declara aria-required

Duas coisas que o componente já fazia certo e ninguém provava. A primeira, se
perdida num refactor, vaza senha digitada entre duas aberturas; a segunda é a
metade que sobrou quando o `required` saiu para tirar o balão nativo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: O botão "Adicionar" para de escorregar

**Files:**
- Modify: `web/admin/src/app/taxonomias/page.tsx:204-224`
- Test: `web/admin/e2e/taxonomias.spec.ts`

**Interfaces:**
- Consumes: `Campo`, `Botao`, `CONTROLE`, `CONTROLE_INVALIDO` de `@mais/ui`.
- Produces: nada. Não toca o `web/ui`.

- [x] **Step 1: Escrever o teste que falha**

Em `web/admin/e2e/taxonomias.spec.ts`, no fim do arquivo:

```ts
// O form era `sm:items-end` e o botão era irmão do BLOCO do campo, não do
// input: quando o <p> de erro aparecia dentro do Campo, o bloco crescia e
// levava o botão junto, para baixo.
test("o botão Adicionar continua alinhado ao input quando o erro aparece", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");

  const input = page.getByLabel("Nome", { exact: true });
  const botao = page.getByRole("button", { name: "Adicionar" });

  const centro = async (alvo: typeof input) => {
    const caixa = await alvo.boundingBox();
    if (!caixa) throw new Error("elemento sem caixa");
    return caixa.y + caixa.height / 2;
  };

  const antes = Math.abs((await centro(botao)) - (await centro(input)));
  expect(antes).toBeLessThan(3);

  // Campo vazio: o erro é inline e não chama a API.
  await botao.click();
  await expect(page.getByText("Informe o nome do termo.")).toBeVisible();

  const depois = Math.abs((await centro(botao)) - (await centro(input)));
  expect(depois).toBeLessThan(3);
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
cd web && npm run test -w admin -- taxonomias.spec.ts
```

Esperado: FALHA na última asserção. Anotar o valor real que o `expect` reportar — é o deslocamento verdadeiro, e ele substitui o "~26px" estimado na spec quando o ledger for atualizado na Task 13.

- [x] **Step 3: Implementar**

Em `web/admin/src/app/taxonomias/page.tsx`, o form passa a ter o botão dentro do `Campo`, como irmão do input:

```tsx
        <form onSubmit={adicionar}>
          <Campo rotulo="Nome" htmlFor="novo-termo" erro={erro ?? undefined}>
            {/* O botão é irmão do input, e não do bloco do campo: assim o <p>
                de erro cresce ABAIXO dos dois e não tem como empurrar um sem
                empurrar o outro. Com o botão fora do Campo, `items-end`
                alinhava pela base do bloco, que muda de altura quando o erro
                aparece. */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="flex-1">
                <input
                  id="novo-termo"
                  className={`${CONTROLE} ${erro ? CONTROLE_INVALIDO : ""}`}
                  aria-invalid={erro ? true : undefined}
                  value={nome}
                  maxLength={120}
                  onChange={(e) => {
                    setNome(e.target.value);
                    if (erro) setErro(null);
                  }}
                />
              </div>
              <Botao type="submit" carregando={salvando} className="shrink-0">
                <IconeAdicionar />
                Adicionar
              </Botao>
            </div>
          </Campo>
        </form>
```

`sm:items-center` e não `items-end`: o input tem 50px de altura e o botão 46px, e centralizar é o que parece alinhado. Abaixo de `sm` a linha vira coluna, como já era.

- [x] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npm test
cd web && npm run typecheck
```

Atenção especial ao caso de 375px em `caminho-critico.spec.ts`: a tela de taxonomias não pode ganhar rolagem horizontal.

- [x] **Step 5: Commit**

```bash
git add web/admin/src/app/taxonomias/page.tsx web/admin/e2e/taxonomias.spec.ts
git commit -m "$(cat <<'EOF'
fix(web): o botão Adicionar para de descer junto com a mensagem de erro

O botão era irmão do bloco inteiro do campo, e `items-end` alinha pela base
desse bloco — quando o <p> de erro aparecia dentro do Campo, o bloco crescia e
levava o botão junto.

Agora ele é irmão do input, dentro do Campo: o erro cresce abaixo dos dois e
não tem como empurrar um sem empurrar o outro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Favicon

**Files:**
- Create: `web/admin/src/app/icon.png`

**Interfaces:**
- Consumes: `web/admin/public/logo.png` (somente leitura).
- Produces: o ícone que o App Router liga sozinho. Nenhum outro arquivo depende dele.

- [x] **Step 1: Medir a caixa do símbolo**

O símbolo — o "Q" com o "+" recortado — ocupa a parte esquerda do arquivo. A caixa é **medida**, não chutada: recortar a fatia esquerda e pedir ao ImageMagick o retângulo do conteúdo dentro dela.

```bash
cd /Users/zava/Develop/projects/zava/mais-aprovacao-questoes
magick web/admin/public/logo.png -crop 760x793+0+0 +repage -fuzz 8% -trim -format "%wx%h%X%Y\n" info:
```

Saída no formato `LARGURAxALTURA+X+Y` — anotar os quatro números. A fatia de 760px de largura pega o símbolo inteiro e para antes do "M" de "Mais" (o texto começa por volta de x=780).

- [x] **Step 2: Gerar o ícone quadrado**

Com os números do Step 1, montar um quadrado centralizado no símbolo, com respiro. Chamando a caixa medida de `L`, `A`, `X`, `Y`:

- lado do quadrado: `max(L, A)` acrescido de ~12% de respiro
- origem: centraliza o símbolo dentro desse quadrado

O comando abaixo faz a conta em shell, então não depende de aritmética manual:

```bash
cd /Users/zava/Develop/projects/zava/mais-aprovacao-questoes
CAIXA=$(magick web/admin/public/logo.png -crop 760x793+0+0 +repage -fuzz 8% -trim -format "%w %h %X %Y" info:)
read L A X Y <<< "$(echo "$CAIXA" | tr -d '+')"
LADO=$(( (L > A ? L : A) * 112 / 100 ))
OX=$(( X - (LADO - L) / 2 ))
OY=$(( Y - (LADO - A) / 2 ))
echo "caixa=${L}x${A}+${X}+${Y}  quadrado=${LADO}+${OX}+${OY}"
magick web/admin/public/logo.png -crop "${LADO}x${LADO}+${OX}+${OY}" +repage -resize 256x256 web/admin/src/app/icon.png
```

- [x] **Step 3: Conferir o resultado a olho**

```bash
magick identify web/admin/src/app/icon.png
open web/admin/src/app/icon.png
```

Esperado: `256x256`, e o símbolo inteiro visível, centralizado, sem cortar borda e sem sobra de branco exagerada. Se o recorte pegou parte do texto ou cortou o "+", ajustar a fatia do Step 1 (o `760`) e repetir.

O arquivo precisa ter poucos KB — se passar de ~60KB, acrescentar `-strip` ao comando.

- [x] **Step 4: Provar que o Next liga o ícone sozinho**

```bash
cd web && npm run build
grep -o 'rel="icon"[^>]*' admin/out/index.html | head -3
ls -la admin/out/icon*
```

Esperado: uma tag `rel="icon"` apontando para o arquivo, e o `icon.png` presente em `out/`.

**Se o build não emitir a tag** (convenção do App Router não aplicada por causa do `output: 'export'`), o caminho alternativo é declarar em `web/admin/src/app/layout.tsx`, dentro do `metadata` que já existe:

```tsx
export const metadata: Metadata = {
  title: "Painel — Mais Aprovação Questões",
  icons: { icon: "/icon.png" },
  robots: { index: false, follow: false },
};
```

e mover o arquivo para `web/admin/public/icon.png`. Essa é a única circunstância em que o `layout.tsx` é tocado nesta rodada.

- [x] **Step 5: Commit**

```bash
git add web/admin/src/app/icon.png
git commit -m "$(cat <<'EOF'
feat(web): o painel ganha favicon, recortado do símbolo da logo

A logo é um wordmark de 2,5:1 — espremida num quadrado de 32px vira borrão. O
que vira ícone é o símbolo: o Q com o + recortado, sobre o mesmo fundo
quase-branco do arquivo original.

A caixa do recorte foi medida com o ImageMagick que já está na máquina, não
estimada. Convenção do App Router: nenhuma linha no layout.tsx.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: As quatro asserções fracas

**Files:**
- Modify: `web/admin/e2e/login.spec.ts` (por volta das linhas 20, 38 e 114)
- Modify: `web/admin/e2e/visual.spec.ts:103-112`

**Interfaces:**
- Consumes: nada.
- Produces: nada. Tarefa de rigor de teste.

- [x] **Step 1: Apertar as três do login**

`toContainText`/`toHaveText` isoladas passam num elemento presente porém oculto. As três ganham `toBeVisible` encadeado antes — mesmo padrão que os outros dois casos do arquivo já adotaram.

Linha ~20 (falha de rede no `/admin/auth/me`):

```ts
  const alerta = page.locator("main").getByRole("alert");
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(/recarregue a página/i);
```

Linha ~38 (senha errada):

```ts
  const alerta = page.locator("main").getByRole("alert");
  await expect(alerta).toBeVisible();
  await expect(alerta).toHaveText(/senha inválida/i);
```

Linha ~114 (admin sem senha):

```ts
  const alerta = page.locator("main").getByRole("alert");
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(
    /entre em contato com o time de desenvolvimento/i,
  );
```

- [x] **Step 2: O cabeçalho passa a provar ordem, não presença**

Em `web/admin/e2e/visual.spec.ts`, substituir o corpo do teste "o cabeçalho segue o padrão de ícone junto do texto":

```ts
test("o cabeçalho segue o padrão de ícone junto do texto", async ({ page }) => {
  await entrar(page);

  for (const nome of ["Trocar senha", "Sair"]) {
    const botao = page.getByRole("button", { name: nome });
    await expect(botao.locator("svg")).toHaveCount(1);

    // Contar svg prova presença, não posição: passaria com o ícone depois do
    // texto. Aqui o ícone é rótulo, não vetor, então vem antes — e a
    // comparação usa childNodes porque o Botao renderiza os filhos crus, e o
    // texto é nó de texto: firstElementChild o ignoraria e acharia o mesmo
    // <svg> de qualquer jeito. É o mesmo raciocínio do teste da paginação.
    expect(
      await botao.evaluate((b) => b.childNodes[0]?.nodeName.toLowerCase()),
    ).toBe("svg");
  }
});
```

- [x] **Step 3: Rodar nos dois navegadores**

```bash
cd web && npm test
```

Esperado: verde. Estas asserções são mais estritas sobre comportamento que já está certo — se alguma falhar, é defeito real e precisa ser investigado, não afrouxado.

- [x] **Step 4: Commit**

```bash
git add web/admin/e2e/login.spec.ts web/admin/e2e/visual.spec.ts
git commit -m "$(cat <<'EOF'
test(web): as quatro asserções fracas passam a exigir o que dizem exigir

Três do login afirmavam texto sem exigir visibilidade — passariam num elemento
presente porém oculto. A do cabeçalho contava svg e provava presença, não a
ordem "ícone antes do texto": passaria com o ícone do lado errado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: A documentação e o ledger

**Files:**
- Modify: `web/README.md:66-76`
- Modify: `docs/superpowers/plans/2026-08-07-painel-follow-ups.md`

**Interfaces:**
- Consumes: tudo o que as Tasks 2 a 12 entregaram.
- Produces: o registro. É o que impede a lista de drifar pela quarta vez.

- [x] **Step 1: O `web/README.md` para de avisar sobre o `Modal`**

Remover inteiro o bloco de citação das linhas 68-76 (o que começa em "**Três botões ainda não cumprem esta regra**" e termina em "ele é o contraexemplo dela"). A regra 2 fica sem ressalva, que é o estado que ela sempre deveria ter tido.

Conferir que a regra 3 (ícone antes do texto, exceto em ação direcional) continua logo abaixo, intacta.

- [x] **Step 2: Fechar as entradas do ledger**

Em `docs/superpowers/plans/2026-08-07-painel-follow-ups.md`:

1. A seção **"Ícone nos botões de diálogo e no login — execução futura, decidida"** vira resolvida. Substituir o cabeçalho e acrescentar, logo abaixo, a nota de fechamento:

```markdown
## ~~Ícone nos botões de diálogo e no login~~ — **resolvido em 2026-08-19**

> O `Modal` ganhou `IconeCancelar` fixo no cancelar e a prop `iconeConfirmar`
> para o confirmar; o login ganhou `IconeEntrar`. O aviso do `web/README.md`
> para não copiar o `Modal` como exemplo saiu junto — a regra 2 não tem mais
> contraexemplo dentro do `web/ui`.
```

2. Na seção **"Acessibilidade"**, a entrada do erro de `excluir()` em toast vira resolvida:

```markdown
| ~~O erro de `excluir()` aparece em toast, enquanto o de `renomear()` cai inline no campo~~ **Resolvido em 2026-08-19** | O `Modal` ganhou a prop `erro`, e `excluir()` passou a usá-la. A regra que ficou: enquanto há diálogo aberto, o erro mora nele — no campo se houver campo culpado, no rodapé do diálogo se não houver. Excluir questão continua em toast e não é exceção: aquele fluxo fecha o diálogo antes de chamar a API |
```

3. A seção **"Sobras do modal de trocar senha — 2026-08-19"** perde seis dos sete itens. Riscar cada um com `~~` e acrescentar `**Resolvido em 2026-08-19**`, **exceto** a parte do Escape, que fica registrada como aberta:

```markdown
- ~~O clique no backdrop descarta três senhas digitadas sem confirmação~~
  **Resolvido em 2026-08-19** — o fundo deixou de fechar os quatro diálogos.
  **Continua aberto:** o Escape faz o mesmo descarte, e continua fazendo. A
  decisão fechou o acidente e deixou em pé a intenção — quem for reabrir isto
  precisa decidir se um diálogo com conteúdo digitado deve confirmar antes de
  descartar.
```

4. Na seção **"Sobras da separação do login do admin"**, a linha final que registra as três asserções restantes de `login.spec.ts` vira resolvida:

```markdown
~~Ainda restam, do e2e do login: três outras asserções de
`web/admin/e2e/login.spec.ts` (por volta das linhas 20, 38 e 114) usam
`toContainText`/`toHaveText` isoladas~~ — **resolvidas em 2026-08-19**, as
três ganharam `toBeVisible` encadeado.
```

5. Na seção **"Sobras de rigor de teste — 2026-08-19"**, o item do cabeçalho vira resolvido:

```markdown
- ~~O teste do cabeçalho conta `svg` e prova presença, não a ordem "ícone
  antes do texto"~~ **Resolvido em 2026-08-19** — passou a comparar contra o
  nó de texto, como o da paginação já fazia.
```

**Não marcar como resolvido nada que esta rodada não tenha tocado.** As três arestas de empacotamento, o auto-submit do Apple Passwords e o `nanoid` continuam exatamente como estão.

- [x] **Step 3: Conferir que nenhum link quebrou**

```bash
cd /Users/zava/Develop/projects/zava/mais-aprovacao-questoes
grep -rn "2026-08-07-painel-follow-ups\|web/README" docs web/README.md | grep -v "^docs/superpowers/plans/2026-08-07"
```

Conferir que os caminhos citados continuam existindo.

- [x] **Step 4: Commit**

```bash
git add web/README.md docs/superpowers/plans/2026-08-07-painel-follow-ups.md
git commit -m "$(cat <<'EOF'
docs: a regra dos botões perde a ressalva, e o ledger fecha nove entradas

A regra 2 do web/README.md não tem mais contraexemplo dentro do web/ui, então
o aviso para não copiar o Modal sai junto com a dívida que o motivava.

O que NÃO foi marcado como resolvido: o Escape continua descartando as senhas
digitadas do modal, e isso fica escrito na mesma entrada que registra o
backdrop como fechado. Fechar o acidente não fecha a intenção.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final

Esta é a verificação **desta** rodada. A da rodada anterior foi a Task 1, e rodou antes de tudo — é o que torna qualquer vermelho daqui atribuível a esta rodada.

- [x] **Suíte do painel, os dois navegadores**

```bash
cd web && npm test
```

Esperado: verde em chromium e WebKit, com os casos novos das Tasks 2 a 12.

- [x] **Suíte da API, em sequência — nunca junto**

```bash
cd api && npm test
```

Esperado: verde. Nenhuma tarefa desta rodada tocou o `api/`, então um vermelho aqui é sinal de disputa do D1 — rodar de novo com a suíte do painel encerrada.

- [x] **Typecheck nos dois workspaces**

```bash
cd web && npm run typecheck
```

- [x] **Build, para o favicon**

```bash
cd web && npm run build
```

Esperado: build limpo, `icon.png` presente em `admin/out/`.

- [x] **Os oito critérios de pronto do §11 da spec**, conferidos um a um contra o que foi entregue:

1. A linha de base do §2 rodou antes da primeira mudança, com resultado registrado, e os checkboxes do plano anterior estão marcados.
2. Nenhum toast aparece enquanto há diálogo aberto na frente.
3. Os quatro modais têm ícone nos dois botões e não fecham no backdrop.
4. O tip de divergência continua vermelho e passou a ser polido.
5. O botão "Adicionar" fica alinhado com o input com e sem erro, nos dois navegadores.
6. O favicon aparece na aba, e o `layout.tsx` não foi tocado (ou foi, e o Step 4 da Task 11 registra por quê).
7. Suítes verdes, typecheck limpo.
8. As entradas do ledger estão fechadas com data, e o `web/README.md` não avisa mais para não copiar o `Modal`.

- [x] **Conferência a olho, no navegador**

```bash
cd api && npm run dev    # num terminal
cd web && npm run dev    # noutro
```

Abrir `http://localhost:3000`, e conferir: o favicon na aba; o `Entrar` com ícone; o texto "Você entrou pelo Cloudflare Access como"; os quatro diálogos com ícone nos dois botões; o clique no fundo não fechando; e o botão "Adicionar" de taxonomias parado no lugar quando o erro aparece.
