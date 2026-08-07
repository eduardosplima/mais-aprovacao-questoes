import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";

test("acervo vazio explica o que fazer", async ({ page }) => {
  await entrar(page);
  await expect(page.getByText(/nenhuma questão/i)).toBeVisible();
});

test("o filtro de situação vai para a query e volta ao ser limpo", async ({
  page,
}) => {
  await entrar(page);

  const chamadas: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/questions")) chamadas.push(r.url());
  });

  await page.getByLabel("Situação").selectOption("published");
  await expect
    .poll(() => chamadas.some((u) => u.includes("status=published")))
    .toBe(true);

  await page.getByLabel("Situação").selectOption("");
  await expect
    .poll(() => chamadas.at(-1)?.includes("status=") === false)
    .toBe(true);
});

test("o botão Nova questão leva ao editor vazio", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Nova questão" }).click();
  await expect(page).toHaveURL(/\/questoes\/editar$/);
});
