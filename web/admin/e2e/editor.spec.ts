import { test, expect, type Page } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

async function criarTaxonomias(page: Page) {
  await page.goto("/taxonomias");
  for (const [aba, nome] of [
    ["Banca", "Cespe"],
    ["Assunto", "Direito Administrativo"],
  ] as const) {
    await page.getByRole("tab", { name: aba }).click();
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.locator("table").getByText(nome)).toBeVisible();
  }
}

test("múltipla escolha: adicionar e remover alternativas", async ({ page }) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  // Começa com quatro — o mínimo confortável, não o mínimo permitido.
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(4);

  await page.getByRole("button", { name: "Adicionar alternativa" }).click();
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(5);

  await page.getByRole("button", { name: "Remover alternativa E" }).click();
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(4);
});

test("certo/errado troca para duas alternativas fixas", async ({ page }) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Tipo").selectOption("true_false");
  // getByText("Certo") casaria também com o <option>Certo/errado</option> do
  // seletor de Tipo (substring, sem diferenciar maiúscula) mesmo com o select
  // fechado — mesma raiz do getByLabel("Nome") vs. "Renomear" na Task 5.
  // O aria-label do radio é exato e testa a semântica que importa aqui: a
  // tela passou a oferecer duas alternativas fixas, Certo e Errado.
  await expect(
    page.getByRole("radio", { name: "Certo é a resposta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Errado é a resposta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adicionar alternativa" }),
  ).toHaveCount(0);
});

test("sem alternativa correta, a API recusa e a tela explica", async ({
  page,
}) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Qual das alternativas está correta?");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Porque sim.");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  // Nenhuma marcada como correta.
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /marque exatamente uma alternativa/i,
  );
});

test("vídeo com mailto: é recusado", async ({ page }) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Enunciado de teste.");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  await page.getByLabel("Vídeo do gabarito").fill("mailto:alguem@exemplo.com");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(/confira os campos/i);
});
