import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";
import { validarQuestao } from "../src/lib/validacao";

test.beforeAll(semear);

// Base válida para os testes de `validarQuestao` que variam só um campo.
const BASE = {
  enunciado: "<p>Enunciado.</p>",
  subjectId: "s1",
  bancaId: "b1",
  ano: "2024",
  gabarito: "<p>Gabarito.</p>",
  videoUrl: "",
  alternativas: [
    { body: "A", isCorrect: true },
    { body: "B", isCorrect: false },
  ],
};

test.describe("validarQuestao: enunciado só com imagem", () => {
  test("não é tratado como vazio", () => {
    // sanitizeHtml (servidor) mantém <img> na allowlist e o editor tem upload
    // de imagem — uma questão puramente gráfica é um enunciado válido.
    const erros = validarQuestao({
      ...BASE,
      enunciado: '<p><img src="foto.png" alt="figura"></p>',
    });
    expect(erros.enunciado).toBeUndefined();
  });
});

test.describe("validarQuestao: vídeo alinhado com isHttpUrl do servidor", () => {
  test("espaço à esquerda — o servidor aceita, o cliente também", () => {
    const erros = validarQuestao({ ...BASE, videoUrl: " https://x.com" });
    expect(erros.videoUrl).toBeUndefined();
  });

  test("uma barra só após o esquema — o servidor aceita, o cliente também", () => {
    const erros = validarQuestao({ ...BASE, videoUrl: "https:/exemplo.com" });
    expect(erros.videoUrl).toBeUndefined();
  });

  test("sem host — o servidor recusa, o cliente também", () => {
    const erros = validarQuestao({ ...BASE, videoUrl: "https://" });
    expect(erros.videoUrl).toBeDefined();
  });

  test("espaço no host — o servidor recusa, o cliente também", () => {
    const erros = validarQuestao({ ...BASE, videoUrl: "https://exa mple.com" });
    expect(erros.videoUrl).toBeDefined();
  });

  test("vídeo sem gabarito é erro — o servidor exige body quando explanation existe", () => {
    const erros = validarQuestao({
      ...BASE,
      gabarito: "<p></p>",
      videoUrl: "https://x.com",
    });
    expect(erros.videoUrl).toBe("O vídeo precisa de um gabarito comentado.");
  });
});

test.describe("validarQuestao: gabarito", () => {
  test("vazio não é erro — o gabarito é opcional", () => {
    // "<p></p>" é o que o editor TipTap devolve depois de esvaziado, nunca
    // "" — o schema do ProseMirror (doc: block+) sempre mantém um parágrafo.
    const erros = validarQuestao({ ...BASE, gabarito: "<p></p>" });
    expect(erros.gabarito).toBeUndefined();
  });
});

test.describe("validarQuestao: ano", () => {
  test("vazio é erro — o ano é obrigatório", () => {
    const erros = validarQuestao({ ...BASE, ano: "" });
    expect(erros.ano).toBe("Informe o ano da questão.");
  });

  test("fora do intervalo continua sendo erro", () => {
    const erros = validarQuestao({ ...BASE, ano: "1800" });
    expect(erros.ano).toBe("Use um ano entre 1900 e 2200.");
  });
});

test("salvar com pendências aponta os campos e não envia nada", async ({
  page,
}) => {
  await entrar(page);

  const envios: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/questions")) {
      envios.push(r.url());
    }
  });

  await page.goto("/questoes/editar");
  await page.getByLabel("Enunciado").fill("Enunciado preenchido.");
  await page.getByLabel("Vídeo do gabarito").fill("youtube.com/watch?v=abc");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  // O resumo no topo enumera o que falta.
  const resumo = page.locator("main").getByRole("alert").first();
  await expect(resumo).toContainText(/assunto/i);
  await expect(resumo).toContainText(/banca/i);

  // O campo do vídeo explica o problema dele, em vez da frase genérica.
  await expect(page.getByLabel("Vídeo do gabarito")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("main")).toContainText(/http:\/\/ ou https:\/\//i);

  // Assunto também fica marcado como inválido, não só com a mensagem no
  // resumo — o SeletorTaxonomia precisa aplicar CONTROLE_INVALIDO e
  // aria-invalid ao <select>, como os outros campos.
  await expect(page.getByLabel("Assunto")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  // Nada foi enviado ao servidor.
  expect(envios).toHaveLength(0);
});

test("corrigidos os campos, o resumo some", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("tab", { name: "Assunto" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Português");
  await page.getByRole("button", { name: "Adicionar" }).click();
  // Como em entrar(): sem isto, o WebKit ocasionalmente vê a navegação
  // seguinte como concorrente com o assentamento da rota atual e falha com
  // "interrompida por outra navegação".
  await page.waitForLoadState("networkidle");

  await page.goto("/questoes/editar");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator("main").getByRole("alert").first()).toBeVisible();

  await page.getByLabel("Enunciado").fill("Enunciado completo.");
  await page.getByLabel("Assunto").selectOption({ label: "Português" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Ano").fill("2024");
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page).toHaveURL("/");
});

test("salvar com pendências durante a pré-visualização não falha em silêncio", async ({
  page,
}) => {
  await entrar(page);

  const envios: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/questions")) {
      envios.push(r.url());
    }
  });

  await page.goto("/questoes/editar");
  await page.getByLabel("Enunciado").fill("Enunciado incompleto.");
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();

  // Antes desta correção: nenhum resumo, nenhum aria-invalid, nenhum toast —
  // o botão não fazia nada visível. Agora sai da pré-visualização e mostra o
  // mesmo resumo do fluxo normal.
  const resumo = page.locator("main").getByRole("alert").first();
  await expect(resumo).toContainText(/assunto/i);
  expect(envios).toHaveLength(0);
});
