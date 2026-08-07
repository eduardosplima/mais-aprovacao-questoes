import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";

test("o preview mostra enunciado, letras e a alternativa correta", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Qual é a capital do Brasil?");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("São Paulo");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Brasília");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Rio de Janeiro");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Salvador");
  await page.getByRole("radio", { name: "Alternativa B é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("Brasília desde 1960.");

  await page.getByRole("button", { name: "Pré-visualizar" }).click();

  await expect(page.getByText("Qual é a capital do Brasil?")).toBeVisible();
  await expect(page.getByText("Brasília desde 1960.")).toBeVisible();
  // A correta é destacada, e só ela.
  await expect(page.getByTestId("alternativa-correta")).toHaveCount(1);
  await expect(page.getByTestId("alternativa-correta")).toContainText("Brasília");

  await page.getByRole("button", { name: "Voltar a editar" }).click();
  await expect(page.getByRole("textbox", { name: "Alternativa A" })).toBeVisible();
});
