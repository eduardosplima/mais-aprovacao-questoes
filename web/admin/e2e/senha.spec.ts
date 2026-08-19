import { test, expect } from "@playwright/test";
import { SENHA } from "./credenciais.mjs";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

// Cada caso parte de uma senha conhecida: o primeiro que trocar a senha
// invalidaria os vizinhos se a semente não voltasse ao estado inicial.
test.beforeEach(semear);

test("a troca exige a senha atual", async ({ page }) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill("nao-e-essa-senha");
  await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await page.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText(
    /senha atual incorreta/i,
  );
});

test("a confirmação precisa bater, e isso nem chega no servidor", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await page.getByLabel("Confirme a nova senha").fill("outra-coisa-comprida");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText(
    /não conferem/i,
  );
});

test("senha nova curta é recusada", async ({ page }) => {
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill("curta12345");
  await page.getByLabel("Confirme a nova senha").fill("curta12345");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText(
    /12 caracteres/i,
  );
});

test("trocada a senha, a nova entra e a antiga não", async ({ page }) => {
  const NOVA = "senha-nova-do-teste";
  await entrar(page);
  await page.goto("/senha");
  await page.getByLabel("Senha atual").fill(SENHA);
  await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await page.getByLabel("Confirme a nova senha").fill(NOVA);
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByRole("status")).toContainText(/senha trocada/i);

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
