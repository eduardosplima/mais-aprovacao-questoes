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
