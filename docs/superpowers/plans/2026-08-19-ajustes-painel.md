# Ajustes do painel — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar as duas regras de design system da spec (campo obrigatório e botões), transformar a troca de senha em modal, e fechar o ledger de dívida do painel.

**Architecture:** Nada de arquitetura nova. Duas props no `Modal` do `web/ui`, um componente novo no `admin` (`ModalTrocarSenha`), quatro ícones, e edições pontuais em telas que já existem. A rota `/senha` é removida. Cada tarefa é verificada pela suíte e2e, que é a única suíte do painel.

**Tech Stack:** Next.js 16 (App Router, `output: 'export'`), React 19, Tailwind v4, Playwright (chromium + WebKit), TypeScript.

**Spec:** [`docs/superpowers/specs/2026-08-19-ajustes-painel-design.md`](../specs/2026-08-19-ajustes-painel-design.md)

## Global Constraints

- **Nenhum pacote npm novo.** Nem dependência, nem devDependency, nem `npx` de pacote que não esteja no `package.json`. Regra do `~/.claude/CLAUDE.md` §5, e nada nesta rodada precisa de pacote.
- **As duas suítes do repositório não rodam juntas.** O `wrangler dev` que o Playwright sobe abre o mesmo SQLite do D1 local (`api/.wrangler/state`) que o vitest do `api/` usa. Rodar em sequência; a disputa derruba testes do painel com cara de defeito de produto.
- **A suíte e2e roda em chromium e WebKit.** `cd web && npm test` sobe os dois servidores sozinho. Um caso que passa só num navegador não está pronto.
- **Código e comentários em português**, comentário explicando *por quê* e não *o quê* — é o padrão de todo o repositório.
- **Mensagem de commit em português**, com o trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **`npm run typecheck` em `web/` cobre os dois workspaces** e precisa ficar limpo ao fim de cada tarefa que toca `.tsx`.
- Antes de rodar a suíte: `cd api && npm run db:migrate:local` e `node web/admin/e2e/seed.mjs` se o D1 local estiver zerado.

---

## Task 1: Login — campo obrigatório no padrão do painel, e o texto do Access

Fecha o pedido 2 e a primeira metade do §2 da spec. O campo Senha deixa de acionar a validação nativa do navegador, e o rodapé muda de texto.

**Files:**
- Modify: `web/admin/src/app/login/page.tsx`
- Test: `web/admin/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `Campo`, `CONTROLE`, `CONTROLE_INVALIDO` de `@mais/ui` (já exportados).
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `web/admin/e2e/login.spec.ts`:

```ts
// A prova de que o balão nativo saiu. Com `required` no lugar, o navegador
// cancela o envio em silêncio: nenhuma requisição sai E nenhuma mensagem
// nossa aparece — então a asserção da mensagem é o que distingue os dois
// mundos, e a da requisição é o que garante que não trocamos um silêncio
// por um POST vazio.
test("senha vazia é barrada pelo painel, não pelo navegador", async ({
  page,
}) => {
  let tentouEntrar = false;
  await page.route("**/admin/auth/login", (rota) => {
    tentouEntrar = true;
    return rota.abort();
  });

  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText("Informe a senha.")).toBeVisible();
  expect(tentouEntrar).toBe(false);
});

test("o rodapé nomeia o Cloudflare Access por extenso", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Encerrar sessão do Cloudflare Access" }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/login.spec.ts --project=chromium
```

Esperado: FAIL nos dois casos novos. O primeiro falha porque "Informe a senha." não existe; o segundo, porque o link ainda diz "Encerrar também a sessão do Access".

- [ ] **Step 3: Implementar**

Em `web/admin/src/app/login/page.tsx`:

Acrescentar o estado do erro do campo, junto dos outros `useState`:

```tsx
const [erroSenha, setErroSenha] = useState<string | null>(null);
```

Trocar o início de `enviar`:

```tsx
  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    // O `required` saiu do input: a validação nativa mostra um balão que o
    // projeto não controla — sem tradução, fora da tipografia do painel, e
    // que some sozinho. Quem chega tarde ao campo não descobre por que o
    // envio não aconteceu.
    if (!senha) {
      setErroSenha("Informe a senha.");
      return;
    }
    setErroSenha(null);
    setEnviando(true);
```

Trocar o bloco do formulário:

```tsx
          <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
            <Campo rotulo="Senha" htmlFor="senha" erro={erroSenha ?? undefined}>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                aria-required
                aria-invalid={erroSenha ? true : undefined}
                className={`${CONTROLE} ${erroSenha ? CONTROLE_INVALIDO : ""}`}
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value);
                  if (erroSenha) setErroSenha(null);
                }}
              />
            </Campo>
```

Acrescentar `CONTROLE_INVALIDO` ao import de `@mais/ui`.

Trocar o texto do rodapé:

```tsx
          Encerrar sessão do Cloudflare Access
```

- [ ] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npx playwright test e2e/login.spec.ts
```

Esperado: PASS, chromium e WebKit.

- [ ] **Step 5: Commit**

```bash
git add web/admin/src/app/login/page.tsx web/admin/e2e/login.spec.ts
git commit -m "$(cat <<'MSG'
feat(web): o login barra senha vazia com a voz do painel, não a do navegador

O balão "Fill out this field" é o único texto da tela que o projeto não
controla: sem tradução, fora da tipografia, e some sozinho — quem não estava
olhando para o campo não descobre por que o envio não aconteceu.

O `required` sai, o `aria-required` fica: o que se descarta é a UI do
navegador, não a informação para leitor de tela.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: `Modal` ganha estado de envio e formulário de verdade

Duas props no `web/ui`, e a adoção da primeira nos modais de taxonomia — que é onde mora o item de duplo clique do ledger.

**Files:**
- Modify: `web/ui/src/Modal.tsx`
- Modify: `web/admin/src/app/taxonomias/page.tsx`
- Test: `web/admin/e2e/taxonomias.spec.ts`

**Interfaces:**
- Produces: `Modal` passa a aceitar `carregando?: boolean` e `idFormulario?: string`. A Task 3 depende das duas.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/taxonomias.spec.ts`:

```ts
// O modal de renomear não tinha estado de envio: dois cliques em Salvar
// eram duas chamadas ao servidor. O segundo PATCH chegava depois do modal
// fechar, e o operador não via nada — a lista já tinha recarregado.
test("dois cliques em Salvar renomeiam uma vez só", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Fundatec");
  await page.getByRole("button", { name: "Adicionar" }).click();

  let chamadas = 0;
  await page.route("**/admin/taxonomy/**", async (rota) => {
    if (rota.request().method() === "PATCH") {
      chamadas += 1;
      // Segura a resposta: sem atraso, a primeira chamada termina antes do
      // segundo clique e o teste passaria mesmo sem a guarda.
      await new Promise((r) => setTimeout(r, 600));
    }
    return rota.continue();
  });

  await page.getByRole("button", { name: "Editar" }).first().click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Novo nome").fill("Fundatec RS");
  const salvar = modal.getByRole("button", { name: "Salvar" });
  await salvar.click();
  await salvar.click({ force: true, timeout: 1000 }).catch(() => undefined);

  await expect(page.getByText("Termo renomeado.")).toBeVisible();
  expect(chamadas).toBe(1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/taxonomias.spec.ts --project=chromium -g "uma vez só"
```

Esperado: FAIL com `expect(chamadas).toBe(1)` recebendo `2`.

- [ ] **Step 3: Implementar as props no `web/ui`**

Em `web/ui/src/Modal.tsx`, na assinatura:

```tsx
export function Modal({
  aberto,
  titulo,
  children,
  aoConfirmar,
  aoCancelar,
  rotuloConfirmar = "Confirmar",
  perigo = false,
  carregando = false,
  idFormulario,
}: {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  rotuloConfirmar?: string;
  perigo?: boolean;
  /** Desabilita o confirmar e troca o texto por "Aguarde…" — a guarda de duplo clique. */
  carregando?: boolean;
  /**
   * Id de um <form> renderizado dentro de `children`. Com ele o confirmar
   * vira o submit desse formulário, e Enter num campo envia — que é o que
   * qualquer pessoa espera de um formulário, e o que um <div> com botões
   * nunca fez.
   */
  idFormulario?: string;
}) {
```

E o botão de confirmar:

```tsx
          <Botao
            variante={perigo ? "perigo" : "primario"}
            carregando={carregando}
            type={idFormulario ? "submit" : "button"}
            form={idFormulario}
            onClick={idFormulario ? undefined : aoConfirmar}
          >
            {rotuloConfirmar}
          </Botao>
```

> O `Cancelar`, o clique no overlay e o Escape continuam funcionando durante o envio, de propósito: a requisição em voo termina de qualquer jeito, e o aviso de sucesso é toast — aparece mesmo com o modal já fechado. Travar a saída daria a impressão de que fechar cancelaria algo, e não cancelaria.

- [ ] **Step 4: Ligar o `carregando` nos modais de taxonomia**

Em `web/admin/src/app/taxonomias/page.tsx`, acrescentar o estado:

```tsx
  const [renomeando, setRenomeando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
```

Em `renomear()`, envolver a chamada:

```tsx
    setErroRenomear(null);
    setRenomeando(true);
    try {
      await api.renomearTermo(alvo.id, limpo);
      setARenomear(null);
      avisar("Termo renomeado.");
      await carregar();
    } catch (falha) {
      // Inline, e não em toast: o toast fica acima do overlay e é fácil de
      // não notar com o modal ainda aberto na frente. O erro pertence ao
      // campo que o causou — é o mesmo tratamento que o cadastro dá ao 409.
      setErroRenomear(mensagemDe(falha));
    } finally {
      setRenomeando(false);
    }
```

Fazer o mesmo em `excluir()` com `setExcluindo`. E passar as props aos dois `Modal`:

```tsx
      <Modal
        aberto={aRenomear !== null}
        titulo="Renomear termo"
        rotuloConfirmar="Salvar"
        carregando={renomeando}
        aoConfirmar={() => void renomear()}
```

```tsx
      <Modal
        aberto={aExcluir !== null}
        titulo="Excluir termo?"
        perigo
        rotuloConfirmar="Excluir"
        carregando={excluindo}
        aoConfirmar={() => void excluir()}
```

- [ ] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm run typecheck && npx playwright test e2e/taxonomias.spec.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/ui/src/Modal.tsx web/admin/src/app/taxonomias/page.tsx web/admin/e2e/taxonomias.spec.ts
git commit -m "$(cat <<'MSG'
feat(ui): o Modal ganha estado de envio, e o duplo clique deixa de duplicar

O Botao já sabia desabilitar e trocar o texto durante o envio; o Modal só não
estava repassando. A prop sozinha não conserta nada — quem decide passá-la é o
chamador —, então os dois modais de taxonomia passam a ligá-la: renomear e
excluir não tinham estado de envio algum.

Entra junto o idFormulario, que faz o confirmar virar submit de um <form> nos
children. É o que faz Enter enviar, que um <div> com botões nunca fez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: Trocar senha vira modal

O maior item da rodada. Fecha os pedidos 5a, 5b e 5c.

**Files:**
- Create: `web/admin/src/componentes/ModalTrocarSenha.tsx`
- Modify: `web/admin/src/componentes/Layout.tsx`
- Delete: `web/admin/src/app/senha/page.tsx` (e o diretório `senha/`)
- Test: `web/admin/e2e/senha.spec.ts` (reescrito)

**Interfaces:**
- Consumes: `Modal` com `carregando` e `idFormulario` (Task 2); `api.trocarSenha(senhaAtual, nova)`; `useToast()`.
- Produces: `<ModalTrocarSenha aberto={boolean} aoFechar={() => void} />`, consumido pela Task 4 no cabeçalho.

- [ ] **Step 1: Escrever a suíte que falha**

Substituir `web/admin/e2e/senha.spec.ts` inteiro:

```ts
import { test, expect, type Page } from "@playwright/test";
import { SENHA } from "./credenciais.mjs";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

// Cada caso parte de uma senha conhecida: o primeiro que trocar a senha
// invalidaria os vizinhos se a semente não voltasse ao estado inicial.
test.beforeEach(semear);

/** O caminho novo: o formulário não tem mais rota própria. */
async function abrirTrocarSenha(page: Page) {
  await entrar(page);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  return page.getByRole("dialog");
}

test("a troca exige a senha atual, e o erro cai no campo que o causou", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("nao-e-essa-senha");
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("Senha atual incorreta.")).toBeVisible();
});

test("senha nova curta é recusada, e o erro cai no campo da nova senha", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("curta12345");
  await modal.getByLabel("Confirme a nova senha").fill("curta12345");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(
    modal.getByText("A senha precisa ter pelo menos 12 caracteres."),
  ).toBeVisible();
});

test("a confirmação precisa bater, e isso nem chega no servidor", async ({
  page,
}) => {
  let saiu = false;
  await page.route("**/admin/auth/senha", (rota) => {
    saiu = true;
    return rota.abort();
  });

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("outra-coisa-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("A confirmação não confere.")).toBeVisible();
  expect(saiu).toBe(false);
});

// 5b: o tip é ao vivo. Sem ele, a pessoa só descobre a divergência depois de
// mandar — e como os dois campos são type=password, ela não tem como conferir
// a olho o que digitou.
test("o tip de divergência aparece enquanto digita, sem clicar em nada", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-compri");

  await expect(modal.getByText("A confirmação não confere.")).toBeVisible();

  // E some sozinho quando passam a bater, sem novo envio.
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await expect(modal.getByText("A confirmação não confere.")).toHaveCount(0);
});

test("campo vazio é barrado pelo painel, não pelo navegador", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("Informe a senha atual.")).toBeVisible();
  await expect(modal.getByText("Informe a nova senha.")).toBeVisible();
});

test("trocada a senha, o modal fecha, a nova entra e a antiga não", async ({
  page,
}) => {
  const NOVA = "senha-nova-do-teste";
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await modal.getByLabel("Confirme a nova senha").fill(NOVA);
  await modal.getByRole("button", { name: "Salvar" }).click();

  // Sucesso é o toast que o resto do painel usa, e a tela por baixo não muda.
  await expect(page.getByText("Senha trocada.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    /senha inválida/i,
  );

  await page.getByLabel("Senha").fill(NOVA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
});

test("Enter no campo envia, sem passar pelo botão", async ({ page }) => {
  const NOVA = "outra-senha-do-teste";
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await modal.getByLabel("Confirme a nova senha").fill(NOVA);
  await modal.getByLabel("Confirme a nova senha").press("Enter");

  await expect(page.getByText("Senha trocada.")).toBeVisible();
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/senha.spec.ts --project=chromium
```

Esperado: FAIL em todos — não existe botão "Trocar senha" que abra diálogo (hoje é um `<Link>` para `/senha`).

- [ ] **Step 3: Criar o componente**

Criar `web/admin/src/componentes/ModalTrocarSenha.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Campo, CONTROLE, CONTROLE_INVALIDO, Modal, useToast } from "@mais/ui";
import { api, ApiError } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const ID_FORM = "form-trocar-senha";

type Erros = {
  atual?: string;
  nova?: string;
  confirmacao?: string;
  geral?: string;
};

/**
 * Atrás do Access (o hostname inteiro está), atrás da sessão do painel e
 * atrás da senha atual — três provas. A terceira é a que impede que uma
 * sessão deixada aberta numa máquina destravada vire sequestro da conta.
 *
 * Não existe recuperação por email para admin: quem esquece a senha pede uma
 * nova pelo CLI (`npm run admin:senha`).
 *
 * É modal, e não rota própria, porque trocar senha não é um lugar aonde se
 * vai: é uma coisa que se faz sem sair de onde se está. Sem navegação não há
 * "voltar para a tela anterior" a resolver, e o sucesso pode ser o mesmo
 * toast que o resto do painel usa.
 */
export function ModalTrocarSenha({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);
  const avisar = useToast();

  // O tip ao vivo (spec §4): com os dois preenchidos e diferentes, a
  // divergência aparece enquanto se digita. Os dois campos são type=password,
  // então a pessoa não tem como conferir a olho o que digitou — descobrir só
  // no envio é descobrir tarde.
  const divergem =
    nova !== "" && confirmacao !== "" && nova !== confirmacao;

  function fechar() {
    setAtual("");
    setNova("");
    setConfirmacao("");
    setErros({});
    aoFechar();
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    // Conferência local: mandar duas senhas para o servidor comparar seria
    // uma ida à rede para descobrir o que já dá para saber aqui.
    const encontrados: Erros = {};
    if (!atual) encontrados.atual = "Informe a senha atual.";
    if (!nova) encontrados.nova = "Informe a nova senha.";
    if (!confirmacao) encontrados.confirmacao = "Confirme a nova senha.";
    else if (nova !== confirmacao) {
      encontrados.confirmacao = "A confirmação não confere.";
    }
    if (Object.keys(encontrados).length > 0) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setEnviando(true);
    try {
      await api.trocarSenha(atual, nova);
      avisar("Senha trocada.");
      fechar();
    } catch (falha) {
      // O erro pertence ao campo que o causou — mesmo tratamento que o 409 de
      // taxonomia recebe. Cair tudo numa linha genérica obrigaria o operador
      // a adivinhar qual dos três campos está errado.
      if (falha instanceof ApiError && falha.codigo === "senha_atual_incorreta") {
        setErros({ atual: mensagemDe(falha) });
      } else if (falha instanceof ApiError && falha.codigo === "weak_password") {
        setErros({ nova: mensagemDe(falha) });
      } else {
        setErros({ geral: mensagemDe(falha) });
      }
    } finally {
      setEnviando(false);
    }
  }

  const erroConfirmacao = erros.confirmacao ?? (divergem ? "A confirmação não confere." : undefined);

  return (
    <Modal
      aberto={aberto}
      titulo="Trocar senha"
      rotuloConfirmar="Salvar"
      carregando={enviando}
      idFormulario={ID_FORM}
      aoConfirmar={() => undefined}
      aoCancelar={fechar}
    >
      <form id={ID_FORM} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Campo rotulo="Senha atual" htmlFor="atual" erro={erros.atual}>
          <input
            id="atual"
            type="password"
            autoComplete="current-password"
            aria-required
            aria-invalid={erros.atual ? true : undefined}
            className={`${CONTROLE} ${erros.atual ? CONTROLE_INVALIDO : ""}`}
            value={atual}
            onChange={(e) => {
              setAtual(e.target.value);
              if (erros.atual) setErros((x) => ({ ...x, atual: undefined }));
            }}
          />
        </Campo>
        <Campo rotulo="Nova senha" htmlFor="nova" erro={erros.nova}>
          <input
            id="nova"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={erros.nova ? true : undefined}
            className={`${CONTROLE} ${erros.nova ? CONTROLE_INVALIDO : ""}`}
            value={nova}
            onChange={(e) => {
              setNova(e.target.value);
              if (erros.nova) setErros((x) => ({ ...x, nova: undefined }));
            }}
          />
        </Campo>
        <Campo
          rotulo="Confirme a nova senha"
          htmlFor="confirmacao"
          erro={erroConfirmacao}
        >
          <input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            aria-required
            aria-invalid={erroConfirmacao ? true : undefined}
            className={`${CONTROLE} ${erroConfirmacao ? CONTROLE_INVALIDO : ""}`}
            value={confirmacao}
            onChange={(e) => {
              setConfirmacao(e.target.value);
              if (erros.confirmacao) {
                setErros((x) => ({ ...x, confirmacao: undefined }));
              }
            }}
          />
        </Campo>
        {erros.geral && (
          <p role="alert" className="text-[13.5px] font-semibold text-erro">
            {erros.geral}
          </p>
        )}
      </form>
    </Modal>
  );
}
```

> **`aoConfirmar={() => undefined}`** não é descuido: com `idFormulario`, o botão vira `type="submit"` do `<form>` e o `onClick` deixa de ser chamado. A prop continua sendo obrigatória na assinatura do `Modal` porque todos os outros chamadores dependem dela.

- [ ] **Step 4: Conferir que `ApiError` é exportado**

```bash
grep -n "export class ApiError\|export { ApiError\|codigo" web/admin/src/lib/api.ts | head
```

Esperado: `ApiError` exportada com a propriedade `codigo`. `sessao.tsx` já a importa de `./api`, então o import acima está correto. Se o nome da propriedade for outro, ajustar as duas comparações de `falha.codigo` no Step 3.

- [ ] **Step 5: Ligar no Layout e apagar a rota**

Em `web/admin/src/componentes/Layout.tsx`, acrescentar o estado e o componente. O botão em si é da Task 4; aqui ele entra ainda sem ícone, só trocando o `<Link>` por um `<Botao>`:

```tsx
  const [trocandoSenha, setTrocandoSenha] = useState(false);
```

```tsx
            <Botao variante="secundario" onClick={() => setTrocandoSenha(true)}>
              Trocar senha
            </Botao>
            <Botao variante="secundario" onClick={sair}>
              Sair
            </Botao>
```

E, antes do fechamento do fragmento (depois do `</main>`):

```tsx
      <ModalTrocarSenha
        aberto={trocandoSenha}
        aoFechar={() => setTrocandoSenha(false)}
      />
```

Ajustar os imports: `useState` de `react`, `ModalTrocarSenha` de `@/componentes/ModalTrocarSenha`, e remover o `Link` se ele deixar de ser usado — conferir que o logo e o `NAV` ainda o usam (usam; o `Link` fica).

Apagar a rota:

```bash
rm -r web/admin/src/app/senha
```

- [ ] **Step 6: Rodar nos dois navegadores**

```bash
cd web && npm run typecheck && npx playwright test e2e/senha.spec.ts
```

Esperado: PASS nos oito casos, chromium e WebKit.

- [ ] **Step 7: Rodar a suíte inteira**

```bash
cd web && npm test
```

Esperado: verde. Esta é a tarefa que apaga uma rota — se algum outro arquivo navegava para `/senha`, é aqui que aparece.

- [ ] **Step 8: Commit**

```bash
git add -A web/admin/src/componentes/ModalTrocarSenha.tsx web/admin/src/componentes/Layout.tsx web/admin/src/app web/admin/e2e/senha.spec.ts
git commit -m "$(cat <<'MSG'
feat(web): trocar senha vira modal, e dois pedidos deixam de existir

Centralizar e voltar para a tela anterior eram dois problemas de uma tela que
não precisava ser tela. Modal nasce centralizado, e não há para onde voltar
quando não se saiu do lugar — o sucesso passa a ser o toast que o resto do
painel já usa.

O tip de divergência é ao vivo: os dois campos são type=password, então
descobrir no envio é descobrir tarde. O erro do servidor cai no campo que o
causou, como o 409 de taxonomia já fazia.

A rota /senha deixa de existir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: Cabeçalho no padrão de botões

**Files:**
- Modify: `web/ui/src/Icone.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/componentes/Layout.tsx`
- Test: `web/admin/e2e/visual.spec.ts`

**Interfaces:**
- Produces: `IconeChave` e `IconeSair` exportados de `@mais/ui`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/visual.spec.ts`:

```ts
test("o cabeçalho segue o padrão de ícone junto do texto", async ({ page }) => {
  await entrar(page);

  for (const nome of ["Trocar senha", "Sair"]) {
    await expect(
      page.getByRole("button", { name: nome }).locator("svg"),
    ).toHaveCount(1);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/visual.spec.ts --project=chromium -g "cabeçalho"
```

Esperado: FAIL — os botões existem (Task 3) mas sem `svg`.

- [ ] **Step 3: Criar os dois ícones**

Em `web/ui/src/Icone.tsx`, ao fim da seção `---- ações ----`:

```tsx
export function IconeChave(p: PropsIcone) {
  return (
    <Svg {...p}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2" />
      <path d="M18 5l2 2" />
      <path d="M15 8l2 2" />
    </Svg>
  );
}

export function IconeSair(p: PropsIcone) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  );
}
```

Em `web/ui/src/index.ts`, acrescentar `IconeChave` e `IconeSair` à lista exportada de `./Icone`.

- [ ] **Step 4: Usar no cabeçalho**

Em `web/admin/src/componentes/Layout.tsx`:

```tsx
            <Botao variante="secundario" onClick={() => setTrocandoSenha(true)}>
              <IconeChave />
              Trocar senha
            </Botao>
            <Botao variante="secundario" onClick={sair}>
              <IconeSair />
              Sair
            </Botao>
```

Importar os dois de `@mais/ui`.

E o gap do ledger, na `div` do cabeçalho (`Layout.tsx:54`), trocando `gap-x-4` por:

```
gap-x-4 md:gap-x-6
```

- [ ] **Step 5: Conferir em 375px**

```bash
cd web && npx playwright test e2e/visual.spec.ts
```

Depois, à mão: `cd web && npm run dev`, abrir `http://localhost:3000` em 375px de largura e conferir que o cabeçalho quebra em linhas sem cortar nenhum botão. Dois botões com texto ocupam mais que um link e um botão — o `flex-wrap` deve absorver, e é isto que se está verificando.

- [ ] **Step 6: Commit**

```bash
git add web/ui/src/Icone.tsx web/ui/src/index.ts web/admin/src/componentes/Layout.tsx web/admin/e2e/visual.spec.ts
git commit -m "$(cat <<'MSG'
feat(web): os dois controles do cabeçalho entram no padrão de botão

Trocar senha era link de texto puro e Sair era botão sem ícone — os dois
únicos controles do painel fora da regra. Entra junto o md:gap-x-6, que um fix
de responsividade tinha derrubado de 24px para 16px sem intenção.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: Paginação com ícone direcional

**Files:**
- Modify: `web/ui/src/Icone.tsx`
- Modify: `web/ui/src/index.ts`
- Modify: `web/admin/src/app/page.tsx:279-297`
- Test: `web/admin/e2e/visual.spec.ts`

**Interfaces:**
- Produces: `IconeAnterior` e `IconeProxima` exportados de `@mais/ui`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/visual.spec.ts`:

```ts
// A paginação só aparece acima de 50 questões, e a semente não chega lá —
// então o total vem forjado, como no caso das ações da linha.
test("a paginação leva a seta do lado para onde aponta", async ({ page }) => {
  await page.route("**/admin/questions**", async (route) => {
    await route.fulfill({
      json: {
        total: 120,
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

  const anterior = page.getByRole("button", { name: "Anterior" });
  const proxima = page.getByRole("button", { name: "Próxima" });
  await expect(anterior.locator("svg")).toHaveCount(1);
  await expect(proxima.locator("svg")).toHaveCount(1);

  // O ícone é vetor, não rótulo: ele diz para onde a ação vai, então precisa
  // estar do lado para onde aponta. Fosse rótulo, viria antes do texto como
  // em todos os outros botões.
  expect(
    await anterior.evaluate((b) => b.firstElementChild?.tagName.toLowerCase()),
  ).toBe("svg");
  expect(
    await proxima.evaluate((b) => b.lastElementChild?.tagName.toLowerCase()),
  ).toBe("svg");
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/visual.spec.ts --project=chromium -g "paginação"
```

Esperado: FAIL — `toHaveCount(1)` recebe `0`.

- [ ] **Step 3: Criar os dois ícones**

Em `web/ui/src/Icone.tsx`, junto de `IconeSeta`:

```tsx
/**
 * Setas de navegação de página. Separadas do `IconeSeta` (que é a do
 * `<select>`, e aponta para baixo) porque significam coisa diferente: aqui a
 * direção é o próprio conteúdo da ação, e é por isso que estes dois ficam do
 * lado para onde apontam em vez de antes do texto.
 */
export function IconeAnterior(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="15 18 9 12 15 6" />
    </Svg>
  );
}

export function IconeProxima(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}
```

Exportar as duas em `web/ui/src/index.ts`.

- [ ] **Step 4: Usar na paginação**

Em `web/admin/src/app/page.tsx`, no bloco de paginação:

```tsx
          <Botao
            variante="secundario"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
          >
            <IconeAnterior />
            Anterior
          </Botao>
```

```tsx
          <Botao
            variante="secundario"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
            <IconeProxima />
          </Botao>
```

Importar os dois de `@mais/ui`.

- [ ] **Step 5: Rodar nos dois navegadores**

```bash
cd web && npm run typecheck && npx playwright test e2e/visual.spec.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/ui/src/Icone.tsx web/ui/src/index.ts web/admin/src/app/page.tsx web/admin/e2e/visual.spec.ts
git commit -m "$(cat <<'MSG'
feat(web): a paginação entra na regra dos botões, com a seta do lado do movimento

Nos outros botões o ícone é rótulo — diz que tipo de ação é aquela — e rótulo
antecede o que nomeia. Aqui ele é vetor: diz para onde a ação vai. A seta de
"Próxima" antes do texto apontaria para fora do próprio botão.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: O Enunciado ganha borda vermelha

Item 4 do ledger. Mesma classe de defeito que a regra do §2 corrige nas outras telas, num componente que a regra sozinha não alcança: `CONTROLE_INVALIDO` se aplica a input e select, e o Enunciado é o wrapper do TipTap.

**Files:**
- Modify: `web/admin/src/componentes/Editor.tsx:81`
- Modify: `web/admin/src/app/questoes/editar/page.tsx` (o `<Campo rotulo="Enunciado">`)
- Test: `web/admin/e2e/validacao.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/admin/e2e/validacao.spec.ts`:

```ts
// A mensagem já aparecia; a borda não. Quem rola um formulário longo procura
// a moldura vermelha, não o texto — foi assim que o campo passou despercebido.
test("o Enunciado vazio ganha borda de erro, não só mensagem", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  const moldura = page
    .getByLabel("Enunciado")
    .locator("xpath=ancestor::div[contains(@class,'rounded-btn')][1]");
  const antes = await moldura.evaluate(
    (e) => getComputedStyle(e).borderTopColor,
  );

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.locator("[data-resumo-erros]")).toBeVisible();

  const depois = await moldura.evaluate(
    (e) => getComputedStyle(e).borderTopColor,
  );
  expect(depois).not.toBe(antes);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd web && npx playwright test e2e/validacao.spec.ts --project=chromium -g "Enunciado vazio"
```

Esperado: FAIL — a cor não muda.

- [ ] **Step 3: Implementar**

Em `web/admin/src/componentes/Editor.tsx`, acrescentar a prop na assinatura do componente (`invalido = false`, tipo `invalido?: boolean`) e trocar o wrapper:

```tsx
    <div
      className={`border rounded-btn bg-white overflow-hidden transition-colors ${
        invalido
          ? "border-erro focus-within:border-erro"
          : "border-borda-2 focus-within:border-roxo"
      }`}
    >
```

> Sem o modificador `!` do Tailwind, ao contrário do `CONTROLE_INVALIDO`: lá o `!important` existe porque `hover:border-borda-3` tem especificidade maior e venceria. Aqui as duas variantes são mutuamente exclusivas na mesma string — não há o que vencer.

Em `web/admin/src/app/questoes/editar/page.tsx`:

```tsx
            <Campo rotulo="Enunciado" erro={erros.enunciado}>
              <Editor
                valor={enunciado}
                aoMudar={setEnunciado}
                rotulo="Enunciado"
                comTabela
                minAltura={200}
                invalido={Boolean(erros.enunciado)}
              />
            </Campo>
```

- [ ] **Step 4: Rodar nos dois navegadores**

```bash
cd web && npm run typecheck && npx playwright test e2e/validacao.spec.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/admin/src/componentes/Editor.tsx web/admin/src/app/questoes/editar/page.tsx web/admin/e2e/validacao.spec.ts
git commit -m "$(cat <<'MSG'
fix(web): o Enunciado inválido passa a ter moldura, e não só mensagem

CONTROLE_INVALIDO se aplica a input e select; o Enunciado é o wrapper do
TipTap, que não usa CONTROLE — a regra de campo obrigatório não alcançava o
único campo que ocupa meia tela. Quem rola um formulário longo procura a
moldura vermelha, não o texto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: `visual.spec.ts` passa a medir o sintoma

Item 9 do ledger. Com o WebKit na suíte existe um navegador onde o `padding-left` distingue o código corrigido do quebrado — no chromium o padding é honrado dos dois jeitos, e por isso a asserção antiga não era regressão de nada.

**Files:**
- Modify: `web/admin/e2e/visual.spec.ts` (o caso "o `<select>` abre mão da aparência nativa…")

- [ ] **Step 1: Trocar a asserção**

Substituir o caso inteiro por:

```ts
test("o <select> honra o padding do autor, e o <input> não ganha seta", async ({
  page,
}) => {
  await entrar(page);

  // Afirma o SINTOMA, não a causa. `appearance: none` é o meio; o fim é o
  // Safari honrar o padding-left do autor — e ele só o descarta enquanto a
  // aparência nativa valer. Com o WebKit na suíte, esta asserção distingue o
  // código corrigido do quebrado; a antiga (`appearance` = `none`) apenas
  // repetia a linha de CSS que ela mesma deveria estar verificando.
  await expect(page.getByLabel("Situação")).toHaveCSS("padding-left", "44px");

  await page.goto("/questoes/editar");
  await expect(page.getByLabel("Tipo")).toHaveCSS("padding-left", "44px");
  await expect(
    page.getByLabel("Tipo").locator("xpath=..").locator("svg"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Assunto")).toHaveCSS("padding-left", "44px");

  // O campo Ano é <input> dentro do mesmo Controle e NÃO leva seta: um campo
  // de texto com seta de lista mentiria sobre o que ele é. Um svg só — o
  // ícone de calendário.
  await expect(
    page.getByLabel("Ano").locator("xpath=..").locator("svg"),
  ).toHaveCount(1);
});
```

- [ ] **Step 2: Provar que a asserção pega o defeito**

Remover temporariamente `appearance-none` da classe do `<select>` de Situação em `web/admin/src/app/page.tsx` e rodar:

```bash
cd web && npx playwright test e2e/visual.spec.ts --project=webkit -g "padding do autor"
```

Esperado: **FAIL no WebKit** — é a prova de que o teste mede algo. Depois, desfazer a remoção (`git checkout web/admin/src/app/page.tsx`) e rodar de novo:

```bash
cd web && npx playwright test e2e/visual.spec.ts
```

Esperado: PASS nos dois navegadores.

- [ ] **Step 3: Commit**

```bash
git add web/admin/e2e/visual.spec.ts
git commit -m "$(cat <<'MSG'
test(web): o select passa a ser medido pelo sintoma, não pela causa

Afirmar `appearance: none` era repetir a linha de CSS que o teste deveria
estar verificando. O que a correção do Safari existe para garantir é o
padding-left do autor ser honrado — e com o WebKit na suíte isso finalmente
distingue o código corrigido do quebrado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: As duas asserções fracas do login

Item 1 do ledger. `toContainText` passa em elemento presente porém oculto; os dois casos ficam com as duas asserções, que é mais estrito que trocar uma pela outra.

**Files:**
- Modify: `web/admin/e2e/login.spec.ts`

- [ ] **Step 1: Apertar as duas**

No caso "contexto que falha mostra a orientação de recarregar":

```ts
  const alerta = page.locator("main").getByRole("alert");
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(/recarregue a página/i);
```

No caso "email fora da allowlist vê a recusa, sem campo de senha":

```ts
  const alerta = page.locator("main").getByRole("alert");
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(/não é administrador/i);
```

- [ ] **Step 2: Rodar**

```bash
cd web && npx playwright test e2e/login.spec.ts
```

Esperado: PASS nos dois navegadores. Os dois elementos já estão renderizados hoje — isto é rigor de asserção, não correção de falso verde.

- [ ] **Step 3: Commit**

```bash
git add web/admin/e2e/login.spec.ts
git commit -m "$(cat <<'MSG'
test(web): os dois alertas do login passam a exigir visibilidade, além do texto

toContainText passa num elemento presente porém oculto. Os dois estão
renderizados hoje, então isto não corrige falso verde — fecha a porta para um.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: O logo para de mentir a proporção

Item 8 do ledger, com causa diferente da registrada. O aviso do `next/image` não vem do `w-auto`: `logo.png` é **1983×793** (proporção 2,5006) e as duas telas declaram dimensões de outra proporção — 180×68 (2,6471) no `Layout` e 200×76 (2,6316) no login.

**Files:**
- Modify: `web/admin/src/componentes/Layout.tsx`
- Modify: `web/admin/src/app/login/page.tsx`

- [ ] **Step 1: Conferir a proporção do arquivo**

```bash
python3 -c "
import struct
d = open('web/admin/public/logo.png','rb').read()
w, h = struct.unpack('>II', d[16:24])
print(w, 'x', h, '=>', round(w/h, 4))
"
```

Esperado: `1983 x 793 => 2.5006`. Se o arquivo tiver mudado, recalcular os pares abaixo mantendo a proporção medida.

- [ ] **Step 2: Corrigir as duas declarações**

`Layout.tsx`: `width={180} height={68}` → `width={180} height={72}` (2,5).

`login/page.tsx`: `width={200} height={76}` → `width={200} height={80}` (2,5).

As classes (`h-10 md:h-[68px] w-auto` e `h-14 w-auto`) **não mudam**: é o `w-auto` que mantém a proporção real na renderização, e ele nunca foi o problema.

- [ ] **Step 3: Verificar no navegador**

```bash
cd web && npm run dev
```

Abrir `http://localhost:3000/login` e `http://localhost:3000` com o console aberto. Esperado: **nenhum** aviso do `next/image` sobre proporção. O logo deve continuar com o mesmo tamanho visual — quem manda no tamanho é a classe, não a prop.

- [ ] **Step 4: Commit**

```bash
git add web/admin/src/componentes/Layout.tsx web/admin/src/app/login/page.tsx
git commit -m "$(cat <<'MSG'
fix(web): o logo declara a proporção que o arquivo tem

O aviso do next/image não vinha do w-auto, como o ledger registrava: logo.png
é 1983x793 (2,5006) e as telas declaravam 180x68 (2,6471) e 200x76 (2,6316).
Era a prop mentindo sobre o arquivo, e o w-auto — que é quem preserva a
proporção real na tela — estava sendo culpado por revelar a mentira.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: Documentação, e o ledger reconferido

Fecha os itens de documento e registra as três entradas do ledger que morreram ou mudaram de diagnóstico. **Nenhuma linha de código.**

**Files:**
- Modify: `web/README.md`
- Modify: `api/README.md:125-136`
- Modify: `docs/superpowers/specs/2026-08-18-login-admin-design.md:196` e `:429`
- Modify: `web/admin/src/lib/sessao.tsx:8-9` (comentário)
- Modify: `docs/runbook-deploy-producao.md` (seção "Publicar a separação do login do admin")
- Modify: `docs/superpowers/plans/2026-08-07-painel-follow-ups.md`

- [ ] **Step 1: As duas regras no `web/README.md`**

Acrescentar, depois do bloco "Atenção para quem for consumir `ui/`":

````markdown
## Regras de design system

Valem para o `admin` e para qualquer consumidor futuro do `ui/`. Moram aqui,
e não só na spec que as criou, porque regra que vive em spec de rodada não é
herdada — é redescoberta, geralmente divergindo.

### Campos obrigatórios

1. **Obrigatório não leva marca no rótulo.** É o default; marcar todo campo
   exigido num formulário em que quase tudo é exigido é ruído.
2. **Opcional leva `dica="Opcional"`**, que o `Campo` renderiza abaixo do
   controle.
3. **Campo vazio nunca aciona a validação nativa do navegador.** O `<form>`
   leva `noValidate`, a conferência é do cliente, e o erro é borda vermelha
   (`CONTROLE_INVALIDO`) mais mensagem no `Campo`.
4. **O atributo `required` não se usa; `aria-required` sim.** O que se
   descarta é a UI do navegador — o balão "Fill out this field", em inglês,
   fora da tipografia do projeto, que some sozinho. A informação para leitor
   de tela fica.
5. **Resumo de erros no topo é só para formulário longo**, onde um campo
   inválido pode estar fora do viewport. Hoje, só o editor de questões.

```tsx
<Campo rotulo="Nova senha" htmlFor="nova" erro={erros.nova}>
  <input
    id="nova"
    type="password"
    aria-required
    aria-invalid={erros.nova ? true : undefined}
    className={`${CONTROLE} ${erros.nova ? CONTROLE_INVALIDO : ""}`}
    value={nova}
    onChange={(e) => setNova(e.target.value)}
  />
</Campo>
```

### Botões

1. **Ação inline em linha de tabela → `BotaoIcone`**: só o ícone, com
   `rotulo` virando `title` e `aria-label`. Texto repetido em N linhas vira
   parede.
2. **Toda outra ação → `Botao` com ícone + texto.** Fora da tabela o botão
   aparece uma vez, e precisa se explicar sem hover — `title` não existe em
   toque.
3. **O ícone vem antes do texto, exceto em ação direcional**, onde ele vai do
   lado para onde aponta. Nos outros botões o ícone é *rótulo* (disquete =
   salvar) e rótulo antecede o que nomeia; numa ação direcional ele é *vetor*,
   e uma seta apontando para fora do próprio botão contradiz o movimento.

```tsx
<BotaoIcone icone={<IconeExcluir />} rotulo="Excluir" onClick={...} />

<Botao><IconeAdicionar />Nova questão</Botao>

<Botao variante="secundario"><IconeAnterior />Anterior</Botao>
<Botao variante="secundario">Próxima<IconeProxima /></Botao>
```
````

Este é o arquivo que o sub-projeto 4 vai ler — a regra precisa caber aqui sem
a spec ao lado.

- [ ] **Step 2: Os códigos de erro do `api/README.md`**

Acrescentar à tabela as linhas que faltam (nove, contando as duas que a separação do login trouxe e que o ledger não listava):

```
| `invalid_credentials` | 401 | Senha do painel incorreta no login do admin |
| `senha_atual_incorreta` | 401 | Senha atual incorreta na troca de senha |
| `weak_password` | 422 | Senha nova com menos de 12 caracteres |
| `captcha_failed` | 400 | Turnstile recusou o token (login do aluno) |
| `missing_file` | 400 | Upload sem arquivo no corpo |
| `too_large` | 413 | Imagem acima de 2 MB |
| `unsupported_type` | 415 | Formato fora de PNG, JPEG, WebP e GIF |
| `unauthorized` | 401 | Sem sessão válida |
| `forbidden` | 403 | Sessão válida sem permissão de admin |
```

Conferir status e nome de cada um antes de escrever:

```bash
grep -rn "invalid_credentials\|senha_atual_incorreta\|weak_password\|captcha_failed\|missing_file\|too_large\|unsupported_type\|unauthorized\|forbidden" api/src --include=*.ts | grep -v test
```

Ajustar a tabela ao que o código de fato emite. **O README precisa refletir a API, não este plano.**

- [ ] **Step 3: "cinco checagens" → seis**

```bash
grep -rn "cinco checagens" docs web api
```

Esperado: três ocorrências. Trocar as três por "seis checagens", acrescentando em cada uma a menção à sexta — a que compara o `iat` do token com o `updated_at` da credencial, e que é o que faz `admin:senha` derrubar sessão viva.

- [ ] **Step 4: Troubleshooting do relógio no runbook**

Na seção "Publicar a separação do login do admin" de `docs/runbook-deploy-producao.md`, depois do passo 9, acrescentar:

```markdown
> **Se logo depois do `admin:senha` a entrada devolver 401, espere alguns
> segundos e tente de novo.** O CLI carimba `updated_at` com o relógio da
> máquina de quem roda, e o `iat` do token vem do relógio do Worker. Se o
> laptop estiver adiantado em N segundos, por N segundos a sexta checagem de
> `requireSessaoAdmin` recusa uma sessão recém-criada — ela parece anterior à
> credencial. Com NTP normal isso é sub-segundo; num laptop com relógio
> manual, pode ser minutos.
```

- [ ] **Step 5: Reconferir o ledger**

Em `docs/superpowers/plans/2026-08-07-painel-follow-ups.md`, marcar como resolvidos os itens fechados por esta rodada (duplo clique, Enunciado, gap do cabeçalho, `visual.spec.ts`, asserções do login, logo, e as três sobras do login), com a data 2026-08-19. E registrar as **três entradas que a releitura do código derrubou**:

```markdown
> **Reconferido em 2026-08-19, na rodada de ajustes. Três entradas não
> sobreviveram à leitura do código — é a terceira vez que esta lista drifta,
> e o padrão já é claro: entrada de ledger envelhece no diagnóstico antes de
> envelhecer no sintoma.**
>
> - **Tipos de `Usuario.role` e `Usuario.tier`: entrada morta.** Não existe
>   mais `Usuario` no `web/` — `grep -rn "Usuario\|\.role\|\.tier"
>   web/admin/src web/ui/src` não devolve nada. A separação do login apagou o
>   modelo de usuário do cliente: `useSessao` devolve `{ email }` e nada mais.
>   A entrada descrevia uma dívida que outra rodada quitou de passagem.
> - **O GET extra da paginação: diagnóstico errado em metade.** O segundo
>   `api.questoes` do recuo é **necessário** — sem ele não há linhas da página
>   corrigida para exibir, e a API não clampa o offset. Já o "Carregando…
>   piscando" não existe: `setCarregando(false)` mora só no `finally`
>   (`page.tsx:106-108`), então os dois fetches acontecem dentro de um único
>   estado de carregamento. Fechada como não é defeito.
> - **Linha da `Tabela` por teclado: fechada como não é defeito.** A coluna
>   Ações tem "Editar", que é botão real, focável e anunciado — o teclado já
>   chega à edição. Pôr `tabIndex` na linha acrescentaria uma parada de
>   tabulação por linha, até 50 numa lista cheia, para chegar ao mesmo lugar.
>   Seria acessibilidade pior com aparência de melhor.
```

E acrescentar o registro do Apple Passwords, copiando o último item do §7 da spec — inclusive as três alavancas não testadas, para a sessão dedicada não recomeçar do zero.

- [ ] **Step 6: Conferir que nenhum link quebrou**

```bash
grep -rn "/senha\b" docs web/README.md api/README.md | grep -v node_modules
```

Esperado: nenhuma referência à rota `/senha` como caminho navegável. Se houver, corrigir para descrever o modal.

- [ ] **Step 7: Commit**

```bash
git add web/README.md api/README.md docs web/admin/src/lib/sessao.tsx
git commit -m "$(cat <<'MSG'
docs: as duas regras ganham lugar fixo, e o ledger perde três entradas

As regras de campo obrigatório e de botões passam a morar no web/README.md,
que é o arquivo que o sub-projeto 4 vai ler — regra que só existe em spec de
rodada não é herdada, é redescoberta.

Três entradas do ledger não sobreviveram à leitura do código: os tipos de
Usuario não existem mais (a separação do login apagou o modelo de usuário do
cliente), o GET extra da paginação é necessário e o "Carregando…" piscando
nunca existiu, e a linha da tabela por teclado seria acessibilidade pior com
aparência de melhor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Verificação final

Depois da Task 10, com tudo commitado:

- [ ] **Suíte do painel, os dois navegadores**

```bash
cd web && npm run typecheck && npm test
```

Esperado: verde nos dois. Anotar a contagem de casos.

- [ ] **Suíte da API, em sequência — nunca junto**

```bash
cd api && npm test
```

Esperado: verde. Nenhuma tarefa desta rodada toca `api/src`, então uma falha aqui é contenção de D1 com a suíte anterior, não regressão — nesse caso, esperar e repetir.

- [ ] **Os sete critérios de pronto do §9 da spec**, conferidos um a um contra o que foi entregue.
