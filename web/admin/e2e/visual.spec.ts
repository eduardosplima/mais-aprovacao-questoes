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

test("os campos de escolha e as abas exibem ícone sem afetar o nome acessível", async ({
  page,
}) => {
  await entrar(page);

  // O Controle envolve o select num div; o ícone semântico fica num <span>
  // irmão à esquerda e a seta noutro à direita, então os dois svg estão a
  // dois níveis do select — subir ao pai e descer é o caminho.
  //
  // São dois e não um porque `appearance-none` apaga a seta nativa: se
  // alguém aplicar a correção do Safari e esquecer a seta, esta contagem cai
  // para 1 e o campo fica sem indicar que é uma lista.
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
  expect(caixaEditar?.height).toBe(36);
  expect(caixaExcluir?.height).toBe(36);

  // O rótulo vira tooltip, e continua sendo o nome acessível.
  await expect(editar).toHaveAttribute("title", "Editar");
  await expect(excluir).toHaveAttribute("title", "Excluir");
});

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

test("o cabeçalho segue o padrão de ícone junto do texto", async ({ page }) => {
  await entrar(page);

  for (const nome of ["Trocar senha", "Sair"]) {
    await expect(
      page.getByRole("button", { name: nome }).locator("svg"),
    ).toHaveCount(1);
  }
});

test("o <select> abre mão da aparência nativa, e o <input> não ganha seta", async ({
  page,
}) => {
  await entrar(page);

  // Afirma a CAUSA, não o sintoma. O sintoma — o Safari descartar o
  // padding-left do autor enquanto `appearance: auto` valer — só é
  // observável no WebKit, que esta suíte ainda não roda (ver
  // docs/proxima-fase-pendencias.md, item 1). No chromium o padding é
  // honrado dos dois jeitos, então `padding-left: 44px` passaria mesmo sem a
  // correção e não serviria de regressão nenhuma.
  await expect(page.getByLabel("Situação")).toHaveCSS("appearance", "none");

  await page.goto("/questoes/editar");
  await expect(page.getByLabel("Tipo")).toHaveCSS("appearance", "none");
  await expect(
    page.getByLabel("Tipo").locator("xpath=..").locator("svg"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Assunto")).toHaveCSS("appearance", "none");

  // O campo Ano é <input> dentro do mesmo Controle e NÃO leva seta: um campo
  // de texto com seta de lista mentiria sobre o que ele é. Um svg só — o
  // ícone de calendário.
  await expect(
    page.getByLabel("Ano").locator("xpath=..").locator("svg"),
  ).toHaveCount(1);
});
