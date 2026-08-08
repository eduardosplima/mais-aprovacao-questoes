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

test("sem alternativa correta, a tela explica antes de enviar", async ({
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
  // Nenhuma marcada como correta. Desde o item 4 quem barra é o cliente, com
  // a mesma frase que a API usaria para exactly_one_correct.
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /marque exatamente uma alternativa/i,
  );
});

test("vídeo sem esquema http é barrado antes de chegar na API", async ({
  page,
}) => {
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

  // Antes esta asserção era /confira os campos/i — a frase genérica que a API
  // devolve para qualquer rejeição do Zod. O ponto do item 4 é justamente que
  // ela não dizia qual campo estava errado.
  await expect(page.getByLabel("Vídeo do gabarito")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("main")).toContainText(/http:\/\/ ou https:\/\//i);
});

test("certo/errado: preenche, salva e aparece na lista", async ({ page }) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Verdadeiro ou falso: 2 + 2 = 4.");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Tipo").selectOption("true_false");
  await page.getByRole("radio", { name: "Certo é a resposta" }).check();
  await page.getByLabel("Gabarito comentado").fill("A soma está correta.");
  await page.getByRole("button", { name: "Publicar" }).click();

  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(
    page.locator("table").getByText("Verdadeiro ou falso: 2 + 2 = 4."),
  ).toBeVisible();
});

test("upload de imagem: insere a tag <img> no enunciado", async ({ page }) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  // PNG 1x1 de verdade — bytes reais, não um arquivo de texto renomeado. O
  // servidor confere os magic bytes (api/src/lib/magicBytes.ts) e recusaria
  // um `.png` fake com 415; provar isso não é o objetivo deste teste, que é
  // o caminho feliz do upload.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA" +
      "60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );

  // O <input type="file"> da barra de ferramentas fica `hidden` de propósito
  // (UploadImagem.tsx) — o botão visível só o aciona por clique de verdade,
  // que o navegador não deixa automatizar. setInputFiles no input escondido
  // dispara o mesmo evento `change` e exercita o mesmo caminho de código.
  //
  // Existem dois — o Enunciado e o Gabarito comentado são cada um seu
  // próprio Editor, cada um com a própria BarraFerramentas. O primeiro no
  // DOM é o do Enunciado (o Card dele vem antes do Card do gabarito).
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "minusculo.png",
      mimeType: "image/png",
      buffer: png,
    });

  await expect(page.getByLabel("Enunciado").locator("img")).toBeVisible();
});
