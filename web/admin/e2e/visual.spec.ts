import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("a célula da tabela alinha o conteúdo ao meio da linha", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/taxonomias");
  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();

  const celula = page.locator("table tbody td").first();
  await expect(celula).toBeVisible();
  await expect(celula).toHaveCSS("vertical-align", "middle");
});

test("os campos de escolha e as abas exibem ícone sem afetar o nome acessível", async ({
  page,
}) => {
  await entrar(page);

  // O Controle envolve o select num div; o ícone semântico fica num <span>
  // irmão à esquerda e a seta noutro à direita, então os dois svg estão a
  // dois níveis do select — subir ao pai e descer é o caminho.
  //
  // São dois e não um porque `appearance-none` apaga a seta nativa: se
  // alguém aplicar a correção do Safari e esquecer a seta, esta contagem cai
  // para 1 e o campo fica sem indicar que é uma lista.
  const situacao = page.getByLabel("Situação");
  await expect(situacao).toBeVisible();
  await expect(situacao.locator("xpath=..").locator("svg")).toHaveCount(2);

  // O aria-hidden do ícone preserva o nome acessível da aba — sem ele,
  // getByRole("tab", { name: "Cargo" }) deixaria de casar.
  await page.goto("/taxonomias");
  const aba = page.getByRole("tab", { name: "Cargo" });
  await expect(aba).toBeVisible();
  await expect(aba.locator("svg")).toHaveCount(1);
});

test("as ações da linha têm a mesma altura e expõem o rótulo como tooltip", async ({
  page,
}) => {
  await page.route("**/admin/questions**", async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        rows: [
          {
            id: "q-1",
            statement: "Questão de exemplo",
            type: "multiple_choice",
            status: "draft",
            year: 2024,
            subjectName: null,
            bancaName: null,
          },
        ],
      },
    });
  });

  await entrar(page);

  const linha = page.locator("table tbody tr").first();
  const editar = linha.getByRole("link", { name: "Editar" });
  const excluir = linha.getByRole("button", { name: "Excluir" });

  const caixaEditar = await editar.boundingBox();
  const caixaExcluir = await excluir.boundingBox();
  expect(caixaEditar?.height).toBe(36);
  expect(caixaExcluir?.height).toBe(36);

  // O rótulo vira tooltip, e continua sendo o nome acessível.
  await expect(editar).toHaveAttribute("title", "Editar");
  await expect(excluir).toHaveAttribute("title", "Excluir");
});

test("os botões de inserção e o rodapé do editor exibem ícone junto do texto", async ({
  page,
}) => {
  await entrar(page);

  const nova = page.getByRole("link", { name: "Nova questão" });
  await expect(nova.locator("svg")).toHaveCount(1);

  await page.goto("/taxonomias");
  await expect(
    page.getByRole("button", { name: "Adicionar" }).locator("svg"),
  ).toHaveCount(1);

  await page.goto("/questoes/editar");
  for (const nome of ["Salvar rascunho", "Publicar", "Cancelar", "Pré-visualizar"]) {
    await expect(
      page.getByRole("button", { name: nome }).locator("svg"),
    ).toHaveCount(1);
  }
});

test("o cabeçalho segue o padrão de ícone junto do texto", async ({ page }) => {
  await entrar(page);

  for (const nome of ["Trocar senha", "Sair"]) {
    await expect(
      page.getByRole("button", { name: nome }).locator("svg"),
    ).toHaveCount(1);
  }
});

test("o <select> honra o padding do autor, e o <input> não ganha seta", async ({
  page,
}) => {
  await entrar(page);

  // Afirma o SINTOMA, não a causa. `appearance: none` é o meio; o fim é o
  // Safari honrar o padding-left do autor — e ele só o descarta enquanto a
  // aparência nativa valer. Com o WebKit na suíte, esta asserção distingue o
  // código corrigido do quebrado; a antiga (`appearance` = `none`) apenas
  // repetia a linha de CSS que ela mesma deveria estar verificando.
  await expect(page.getByLabel("Situação")).toHaveCSS("padding-left", "44px");

  await page.goto("/questoes/editar");
  await expect(page.getByLabel("Tipo")).toHaveCSS("padding-left", "44px");
  await expect(
    page.getByLabel("Tipo").locator("xpath=..").locator("svg"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Assunto")).toHaveCSS("padding-left", "44px");

  // O campo Ano é <input> dentro do mesmo Controle e NÃO leva seta: um campo
  // de texto com seta de lista mentiria sobre o que ele é. Um svg só — o
  // ícone de calendário.
  await expect(
    page.getByLabel("Ano").locator("xpath=..").locator("svg"),
  ).toHaveCount(1);
});

// A paginação só aparece acima de 50 questões, e a semente não chega lá —
// então o total vem forjado, como no caso das ações da linha.
test("a paginação leva a seta do lado para onde aponta", async ({ page }) => {
  await page.route("**/admin/questions**", async (route) => {
    await route.fulfill({
      json: {
        total: 120,
        rows: [
          {
            id: "q-1",
            statement: "Questão de exemplo",
            type: "multiple_choice",
            status: "draft",
            year: 2024,
            subjectName: null,
            bancaName: null,
          },
        ],
      },
    });
  });

  await entrar(page);

  const anterior = page.getByRole("button", { name: "Anterior" });
  const proxima = page.getByRole("button", { name: "Próxima" });
  await expect(anterior.locator("svg")).toHaveCount(1);
  await expect(proxima.locator("svg")).toHaveCount(1);

  // O ícone é vetor, não rótulo: ele diz para onde a ação vai, então precisa
  // estar do lado para onde aponta. Fosse rótulo, viria antes do texto como
  // em todos os outros botões.
  //
  // A comparação usa childNodes, não firstElementChild/lastElementChild: o
  // Botao renderiza os filhos crus, então "Anterior"/"Próxima" viram nó de
  // texto ao lado do <svg> — cada botão só tem UM filho que é Element.
  // first/lastElementChild ignoram nós de texto, então achariam o mesmo
  // <svg> nos dois lados não importa a ordem entre ícone e texto — a
  // checagem passaria mesmo com a seta do lado errado. childNodes inclui o
  // nó de texto e preserva a posição real entre os dois.
  expect(
    await anterior.evaluate((b) => b.childNodes[0]?.nodeName.toLowerCase()),
  ).toBe("svg");
  expect(
    await proxima.evaluate(
      (b) => b.childNodes[b.childNodes.length - 1]?.nodeName.toLowerCase(),
    ),
  ).toBe("svg");
});
