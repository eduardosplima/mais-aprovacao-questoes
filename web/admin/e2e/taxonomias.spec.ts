import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";
import { semear } from "./seed.mjs";

test.beforeAll(semear);

// "Nome" com exact: true — sem isso, getByLabel casa por substring
// case-insensitive, e "Re[nome]ar" contém "nome": assim que uma linha
// existe, o campo colidiria com o aria-label do botão "Renomear X".
//
// getByText(nome) e os botões de linha ("Renomear X" / "Excluir X") são
// escopados em page.locator("table") pelo mesmo motivo do lista.spec.ts: a
// Tabela renderiza cada linha duas vezes no DOM (versão desktop e mobile,
// alternadas só por CSS conforme o viewport), então as duas estão sempre
// presentes e um seletor sem escopo vira violação de strict mode.

test("cria, renomeia e exclui um termo", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Taxonomias" }).click();

  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cespe")).toBeVisible();

  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Cespe" })
    .click();
  await page.getByLabel("Novo nome").fill("Cebraspe");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toBeVisible();

  await page
    .locator("table")
    .getByRole("button", { name: "Excluir Cebraspe" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await expect(page.getByText("Cebraspe")).toHaveCount(0);
});

test("nome repetido no mesmo tipo mostra o 409 traduzido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("FGV")).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(/já existe um termo ativo/i);
});

test("o mesmo nome em tipos diferentes é permitido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();

  await page.getByRole("tab", { name: "Cargo" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

// O campo perdeu o `required` de propósito: o balão nativo do navegador não
// segue o padrão de erro do painel, e ele aceitava " " como preenchido. Estes
// dois testes fixam o que entrou no lugar — mensagem inline e nenhuma
// requisição — porque um `required` de volta passaria despercebido de outro
// jeito.

test("adicionar com o campo vazio mostra erro inline e não chama a API", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  let posts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/admin/taxonomy")) posts++;
  });

  await page.getByRole("button", { name: "Adicionar" }).click();

  const campo = page.getByLabel("Nome", { exact: true });
  await expect(page.locator("main").getByRole("alert")).toHaveText("Informe o nome do termo.");
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  expect(posts).toBe(0);

  // Digitar limpa o erro: o campo volta ao normal antes de haver novo envio.
  await campo.fill("Vunesp");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(campo).not.toHaveAttribute("aria-invalid", "true");
});

test("adicionar com só espaços é barrado no cliente", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  let posts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/admin/taxonomy")) posts++;
  });

  await page.getByLabel("Nome", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Adicionar" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText("Informe o nome do termo.");
  expect(posts).toBe(0);
});

test("renomear com só espaços é barrado no modal, sem chamar a API", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Fundatec");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Fundatec")).toBeVisible();

  let patches = 0;
  page.on("request", (req) => {
    if (req.method() === "PATCH" && req.url().includes("/admin/taxonomy/")) patches++;
  });

  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Fundatec" })
    .click();

  const dialogo = page.getByRole("dialog");
  const campo = dialogo.getByLabel("Novo nome");
  await campo.fill("   ");
  await dialogo.getByRole("button", { name: "Salvar" }).click();

  // O modal continua aberto e explica no próprio campo.
  await expect(dialogo.getByRole("alert")).toHaveText("Informe o nome do termo.");
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  expect(patches).toBe(0);

  // Corrigido, o mesmo modal conclui — o erro não deixa o formulário travado.
  await campo.fill("Fundatec RS");
  await expect(dialogo.getByRole("alert")).toHaveCount(0);
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("table").getByText("Fundatec RS")).toBeVisible();
});

// O modal de renomear não tinha estado de envio: dois cliques em Salvar
// eram duas chamadas ao servidor. O segundo PATCH chegava depois do modal
// fechar, e o operador não via nada — a lista já tinha recarregado.
test("dois cliques em Salvar renomeiam uma vez só", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");
  // Nomes exclusivos deste teste: a suíte roda em série sobre o mesmo D1
  // local, e tanto "Fundatec" quanto "Fundatec RS" já são usados por outro
  // teste do arquivo — reaproveitá-los faria o rename esbarrar num 409 por
  // nome já existente, em vez de exercitar a guarda de duplo clique.
  await page.getByLabel("Nome", { exact: true }).fill("Ibade");
  await page.getByRole("button", { name: "Adicionar" }).click();

  let chamadas = 0;
  await page.route("**/admin/taxonomy/**", async (rota) => {
    if (rota.request().method() === "PATCH") {
      chamadas += 1;
      // Segura a resposta: sem atraso, a primeira chamada termina antes do
      // segundo clique e o teste passaria mesmo sem a guarda.
      await new Promise((r) => setTimeout(r, 600));
    }
    return rota.continue();
  });

  // Escopado em "table" e pelo nome exato do termo recém-criado: a suíte
  // roda os testes em série sobre o mesmo D1 local, então a aba Banca já tem
  // linhas de testes anteriores, e um seletor genérico pegaria o primeiro
  // "Renomear" da tabela — que não é necessariamente o deste Ibade.
  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Ibade", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Novo nome").fill("Ibade Nordeste");
  const salvar = modal.getByRole("button", { name: "Salvar" });
  await salvar.click();
  await salvar.click({ force: true, timeout: 1000 }).catch(() => undefined);

  await expect(page.getByText("Termo renomeado.")).toBeVisible();
  expect(chamadas).toBe(1);
});

test("renomear para um nome que já existe explica dentro do modal", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  for (const nome of ["Quadrix", "Consulplan"]) {
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.locator("table").getByText(nome)).toBeVisible();
  }

  await page
    .locator("table")
    .getByRole("button", { name: "Renomear Quadrix" })
    .click();

  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Novo nome").fill("Consulplan");
  await dialogo.getByRole("button", { name: "Salvar" }).click();

  // O 409 aparece no campo que o causou, e não como toast atrás do overlay.
  await expect(dialogo.getByRole("alert")).toHaveText(/já existe um termo ativo/i);
  await expect(page.locator("table").getByText("Quadrix")).toBeVisible();
});
