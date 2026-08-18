import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { aguardarFormularioVivo, entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("login → cadastrar → publicar → aparece na lista", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");

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
  await expect(page).toHaveURL("/");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();
  await expect(page.locator("table").getByText("Publicada")).toBeVisible();

  // 5. Controle negativo: um rascunho para provar que o filtro filtra, não
  // só que a questão publicada aparece — com uma questão só no acervo, um
  // filtro quebrado (query param ignorado, cláusula errada no backend)
  // passaria pelo teste antigo do mesmo jeito.
  await page.getByRole("link", { name: "Nova questão" }).click();
  await page.getByLabel("Enunciado").fill("Questão de rascunho para controle");
  await page.getByLabel("Assunto").selectOption({ label: "Português" });
  await page.getByLabel("Banca").selectOption({ label: "Cebraspe" });
  await page.getByLabel("Ano").fill("2026");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("Primeira");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Segunda");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Terceira");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Quarta");
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("Rascunho, não publicado.");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL("/");

  // 6. O filtro de publicadas encontra a publicada e não o rascunho.
  await page.getByLabel("Situação").selectOption("published");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();
  await expect(
    page.locator("table").getByText("Questão de rascunho para controle"),
  ).not.toBeVisible();

  // 7. E o inverso: o filtro de rascunho encontra só o rascunho.
  await page.getByLabel("Situação").selectOption("draft");
  await expect(
    page.locator("table").getByText("Questão de rascunho para controle"),
  ).toBeVisible();
  await expect(
    page.locator("table").getByText("Assinale a alternativa correta."),
  ).not.toBeVisible();

  // 8. Reabrir preserva tudo — o id não muda ao editar (spec §1)
  await page.getByLabel("Situação").selectOption("published");
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

const ENUNCIADO_RESPONSIVO = "Questão para checagem de layout responsivo.";

// 320 é o iPhone SE (1ª geração) e boa parte dos Android de entrada — a
// largura comum mais estreita. 360 é o Android comum, 390 o iPhone moderno.
// Três larguras bem diferentes, para não confiar só na folga de uma.
const LARGURAS = [320, 360, 390];

// A lista e as taxonomias têm Tabela; o editor não tem tabela nenhuma, mas é
// a tela mais densa (grade de três colunas, barra de ~12 botões) — a que tem
// mais chance de estourar a largura antes das outras.
const TELAS = ["/", "/taxonomias", "/questoes/editar"];

// Sem uma questão de verdade, `toBeHidden()` em <table> passa com o acervo
// vazio — a Tabela do design system nem renderiza <table> quando não há
// linha nenhuma (web/ui/src/Tabela.tsx:23) — e continuaria passando mesmo que
// a tabela desktop fosse removida do design system inteiramente. Roda como
// teste próprio (não um `beforeAll` com `browser.newPage()`) para herdar o
// `baseURL` do projeto pela fixture `page`, e porque workers: 1 garante que
// os testes deste arquivo rodam na ordem declarada.
test("prepara taxonomias e uma questão para os testes de layout responsivo", async ({
  page,
}) => {
  await entrar(page);

  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Banca Responsiva");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(
    page.locator("table").getByText("Banca Responsiva"),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Assunto" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Assunto Responsivo");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(
    page.locator("table").getByText("Assunto Responsivo"),
  ).toBeVisible();

  await page.goto("/questoes/editar");
  await page.getByLabel("Enunciado").fill(ENUNCIADO_RESPONSIVO);
  await page.getByLabel("Assunto").selectOption({ label: "Assunto Responsivo" });
  await page.getByLabel("Banca").selectOption({ label: "Banca Responsiva" });
  await page.getByLabel("Ano").fill("2026");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("Primeira");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Segunda");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Terceira");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Quarta");
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page).toHaveURL("/");
});

for (const largura of LARGURAS) {
  for (const tela of TELAS) {
    test(`${tela} sem rolagem horizontal em ${largura}px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 844 });
      await entrar(page);
      if (tela !== "/") await page.goto(tela);

      // Sem rolagem horizontal: é o sintoma mais comum de layout que não responde.
      const estouro = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(estouro).toBe(false);
    });
  }

  test(`a tabela vira lista de cartões em ${largura}px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 844 });
    await entrar(page);

    // As duas direções: a tabela desktop some, e a lista de cartões mobile —
    // que é quem carrega o conteúdo nessa largura — aparece de verdade.
    await expect(page.locator("table")).toBeHidden();
    await expect(page.locator("ul").getByText(ENUNCIADO_RESPONSIVO)).toBeVisible();
  });
}
