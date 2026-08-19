import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { aguardarFormularioVivo } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("sem sessão, qualquer tela redireciona para o login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a tela mostra o email do Access e não pede email", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

test("senha errada mostra a mensagem e não entra", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill("senha-errada-mas-longa");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /senha inválida/i,
  );
  await expect(page).toHaveURL(/\/login/);
});

test("senha certa entra e a topbar mostra o email", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(EMAIL)).toBeVisible();
});

test("sair limpa a sessão e volta ao login", async ({ page }) => {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  // Como em entrar(): dar tempo da troca de rota sossegar antes do próximo
  // goto, senão o WebKit vê os dois como navegações concorrentes.
  await page.waitForLoadState("networkidle");

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

// Os dois estados abaixo dependem do que o Access mandaria, que em
// desenvolvimento é fixo — então o contexto é interceptado. É o mesmo recurso
// que visual.spec.ts já usa para fixar a lista de questões.
test("email fora da allowlist vê a recusa, sem campo de senha", async ({
  page,
}) => {
  await page.route("**/admin/auth/contexto", (rota) =>
    rota.fulfill({
      json: { email: "outra@pessoa.com", ehAdmin: false, temSenha: false },
    }),
  );
  await page.goto("/login");
  // main, como em "senha errada": fora dele o Next também tem um role="alert"
  // próprio (o anunciador de rota), sempre presente e sem relação com a tela.
  await expect(page.locator("main").getByRole("alert")).toContainText(
    /não é administrador/i,
  );
  await expect(page.getByLabel("Senha")).toHaveCount(0);
});

test("admin sem senha é mandado ao time de desenvolvimento", async ({
  page,
}) => {
  await page.route("**/admin/auth/contexto", (rota) =>
    rota.fulfill({ json: { email: EMAIL, ehAdmin: true, temSenha: false } }),
  );
  await page.goto("/login");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    /entre em contato com o time de desenvolvimento/i,
  );
  await expect(page.getByLabel("Senha")).toHaveCount(0);
});
