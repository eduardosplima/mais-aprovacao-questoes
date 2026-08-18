import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { aguardarFormularioVivo } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("sem sessão, qualquer tela redireciona para o login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("credencial errada mostra a mensagem genérica e não entra", async ({
  page,
}) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /email ou senha inválidos/i,
  );
  await expect(page).toHaveURL(/\/login/);
});

test("credencial correta entra e a topbar mostra quem está logado", async ({
  page,
}) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText("Admin Dev")).toBeVisible();
});

test("sair limpa a sessão e volta ao login", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
