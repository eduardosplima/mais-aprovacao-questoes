import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("login → cadastrar → publicar → aparece na lista", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");

  // 2. Taxonomias mínimas
  await page.getByRole("link", { name: "Taxonomias" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Cebraspe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toBeVisible();

  await page.getByRole("tab", { name: "Assunto" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Português");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Português")).toBeVisible();

  // 3. Cadastrar e publicar num envio só (o "cadastro em um step" da §2)
  // exact: true — sem isso, "Questões" também casa o link da logo, cujo nome
  // acessível vem do alt da imagem: "Mais Aprovação Questões" contém
  // "Questões" como substring. Mesma raiz das colisões de Nome/Renomear e
  // Certo/Certo-errado.
  await page.getByRole("link", { name: "Questões", exact: true }).click();
  await page.getByRole("link", { name: "Nova questão" }).click();

  await page.getByLabel("Enunciado").fill("Assinale a alternativa correta.");
  await page.getByLabel("Assunto").selectOption({ label: "Português" });
  await page.getByLabel("Banca").selectOption({ label: "Cebraspe" });
  await page.getByLabel("Ano").fill("2026");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("Primeira");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Segunda");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Terceira");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Quarta");
  await page.getByRole("radio", { name: "Alternativa C é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("A terceira está certa.");
  await page.getByRole("button", { name: "Publicar" }).click();

  // 4. Aparece na lista, já publicada
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();
  await expect(page.locator("table").getByText("Publicada")).toBeVisible();

  // 5. E o filtro de publicadas a encontra
  await page.getByLabel("Situação").selectOption("published");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();

  // 6. Reabrir preserva tudo — o id não muda ao editar (spec §1)
  await page.locator("table").getByText("Assinale a alternativa correta.").click();
  await expect(page).toHaveURL(/\/questoes\/editar\?id=/);
  await expect(page.getByRole("textbox", { name: "Alternativa C" })).toHaveValue(
    "Terceira",
  );
  // Escopado em <main>: aqui é o editor, não a lista — o badge de situação
  // não vive numa linha da Tabela, mas sem o escopo "Publicada" também casa
  // o toast "Questão publicada." ainda na tela (fora do main, ao lado do
  // header — mesma razão de page.locator("main").getByRole("alert")).
  await expect(page.locator("main").getByText("Publicada")).toBeVisible();
});

test("responde em viewport de celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrar(page);

  // Sem rolagem horizontal: é o sintoma mais comum de layout que não responde.
  const estouro = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(estouro).toBe(false);

  // A tabela virou lista de cartões.
  await expect(page.locator("table")).toBeHidden();
});
