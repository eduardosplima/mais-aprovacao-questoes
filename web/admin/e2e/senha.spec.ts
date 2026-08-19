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
