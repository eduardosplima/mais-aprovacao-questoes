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
