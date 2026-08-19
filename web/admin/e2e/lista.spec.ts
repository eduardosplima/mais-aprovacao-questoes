import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

test("acervo vazio explica o que fazer", async ({ page }) => {
  await entrar(page);
  await expect(page.getByText(/nenhuma questão/i)).toBeVisible();
});

test("o filtro de situação vai para a query e volta ao ser limpo", async ({
  page,
}) => {
  await entrar(page);

  const chamadas: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/questions")) chamadas.push(r.url());
  });

  await page.getByLabel("Situação").selectOption("published");
  await expect
    .poll(() => chamadas.some((u) => u.includes("status=published")))
    .toBe(true);

  await page.getByLabel("Situação").selectOption("");
  await expect
    .poll(() => chamadas.at(-1)?.includes("status=") === false)
    .toBe(true);
});

test("o botão Nova questão leva ao editor vazio", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Nova questão" }).click();
  await expect(page).toHaveURL(/\/questoes\/editar$/);
});

test("filtro de situação inválido no servidor mostra o erro em vez do acervo inteiro", async ({
  page,
}) => {
  // Registra o mock antes de entrar: o primeiro GET dispara já no redirect
  // pós-login pra "/", antes de qualquer interação — se o route() entrar
  // depois do entrar(page), perde essa primeira chamada.
  //
  // Sem mock, o acervo semeado está vazio e não daria pra distinguir "erro
  // escondeu o acervo" de "acervo sempre esteve vazio". Simula uma questão
  // real na primeira chamada e força 400 na chamada filtrada, pra provar que
  // a linha visível some quando o filtro falha.
  await page.route("**/admin/questions**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("status")) {
      await route.fulfill({ status: 400, json: { error: "invalid_status" } });
      return;
    }
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

  // A Tabela renderiza a mesma linha duas vezes no DOM (versão desktop e
  // mobile, uma escondida por CSS conforme o viewport) — escopar pra
  // <table> evita a violação de strict mode e confere a versão visível.
  await entrar(page);
  await expect(
    page.locator("table").getByText("Questão de exemplo"),
  ).toBeVisible();

  await page.getByLabel("Situação").selectOption("published");

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /situação inválido/i,
  );
  await expect(
    page.locator("table").getByText("Questão de exemplo"),
  ).not.toBeVisible();
});

test("depois de excluir o único item da última página, a lista recua para a página anterior", async ({
  page,
}) => {
  // 51 questões reais deixariam o seed lento; simula o encolhimento do total
  // via mock, espelhando o D1 sem clamp de offset (api/src/db/questions.ts):
  // pedir a página 1 depois da exclusão devolve `rows: []` em vez de vir
  // clampado pro offset válido. Registrado antes de entrar() pelo mesmo
  // motivo do teste anterior: o primeiro GET dispara no redirect pós-login.
  let excluida = false;
  const linha = (n: number) => ({
    id: `q-${n}`,
    statement: `Questão ${n}`,
    type: "multiple_choice",
    status: "draft",
    year: 2024,
    subjectName: null,
    bancaName: null,
  });

  await page.route("**/admin/questions**", async (route) => {
    const req = route.request();
    if (req.method() === "DELETE") {
      excluida = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const url = new URL(req.url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const total = excluida ? 50 : 51;
    // 50 espelha POR_PAGINA da tela (src/app/page.tsx); não é exportado, então
    // repete aqui — mudar um sem o outro quebra este teste, o que é o ponto.
    const rows =
      offset === 50
        ? excluida
          ? []
          : [linha(50)]
        : Array.from({ length: Math.min(50, total) }, (_, i) => linha(i));
    await route.fulfill({ json: { rows, total } });
  });

  await entrar(page);
  await page.getByRole("button", { name: "Próxima" }).click();
  // Escopado pra <table>: a Tabela renderiza a mesma linha de novo (oculta
  // por CSS) na versão mobile, o que violaria o strict mode do Playwright.
  await expect(page.locator("table").getByText("Questão 50")).toBeVisible();

  // Idem: o botão de ação existe duas vezes (linha desktop e mobile).
  await page.locator("table").getByRole("button", { name: "Excluir" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("button", { name: "Cancelar" }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    dialogo.getByRole("button", { name: "Excluir", exact: true }).locator("svg"),
  ).toHaveCount(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Excluir" })
    .click();

  // A tela recua sozinha para a última página válida (0) em vez de mostrar
  // "nenhuma questão" com 50 questões vivas escondidas atrás dela — e sem
  // "Anterior" pra escapar, que era exatamente o efeito colateral do bug.
  await expect(page.locator("table").getByText("Questão 0")).toBeVisible();
  await expect(page.getByText(/nenhuma questão/i)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Próxima" }),
  ).not.toBeVisible();
});
