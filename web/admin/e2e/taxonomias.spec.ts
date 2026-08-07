import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

// "Nome" com exact: true — sem isso, getByLabel casa por substring
// case-insensitive, e "Re[nome]ar" contém "nome": assim que uma linha
// existe, o campo colidiria com o aria-label do botão "Renomear X".
//
// getByText(nome) e os botões de linha ("Renomear X" / "Excluir X") são
// escopados em page.locator("table") pelo mesmo motivo do lista.spec.ts: a
// Tabela renderiza cada linha duas vezes no DOM (versão desktop e mobile,
// alternadas só por CSS conforme o viewport), então as duas estão sempre
// presentes e um seletor sem escopo vira violação de strict mode.

test("cria, renomeia e exclui um termo", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Taxonomias" }).click();

  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cespe")).toBeVisible();

  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Cespe" })
    .click();
  await page.getByLabel("Novo nome").fill("Cebraspe");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toBeVisible();

  await page
    .locator("table")
    .getByRole("button", { name: "Excluir Cebraspe" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await expect(page.getByText("Cebraspe")).toHaveCount(0);
});

test("nome repetido no mesmo tipo mostra o 409 traduzido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("FGV")).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(/já existe um termo ativo/i);
});

test("o mesmo nome em tipos diferentes é permitido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();

  await page.getByRole("tab", { name: "Cargo" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
