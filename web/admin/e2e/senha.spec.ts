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

  // Não basta a frase aparecer em algum lugar do modal — ela precisa estar
  // marcada no campo "Senha atual" via aria-invalid, senão uma implementação
  // que jogasse tudo na linha geral passaria com o mesmo texto.
  await expect(modal.getByLabel("Senha atual")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
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

  // Mesma lógica: a frase sozinha não prova o campo, o aria-invalid prova.
  await expect(
    modal.getByLabel("Nova senha", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
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

// I1: o erro de confirmação nasceu do envio, não de digitar em "Confirme a
// nova senha" — corrigir pelo outro lado (a "Nova senha", até bater com o
// que já estava em "Confirme") também precisa apagar a mensagem. Sem isso
// ela fica presa num campo que já está correto.
test("o erro de confirmação também some ao corrigir pela Nova senha, não só pela confirmação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("outra-coisa-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("A confirmação não confere.")).toBeVisible();

  await modal.getByLabel("Nova senha", { exact: true }).fill("outra-coisa-comprida");
  await expect(modal.getByText("A confirmação não confere.")).toHaveCount(0);
});

// Espelho do I1: erros.confirmacao tem duas causas (campo vazio ou
// divergência). Editar "Nova senha" resolve a segunda, mas não a primeira —
// "Confirme a nova senha" continua vazio, então a mensagem de campo
// obrigatório não pode sumir por causa de uma edição em outro campo.
test("a mensagem de confirmação vazia não some ao editar a Nova senha, só ao preencher a confirmação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("Confirme a nova senha.")).toBeVisible();

  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida2");
  await expect(modal.getByText("Confirme a nova senha.")).toBeVisible();
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

test("os botões do modal de senha têm ícone junto do texto", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  const cancelar = modal.getByRole("button", { name: "Cancelar" });
  const salvar = modal.getByRole("button", { name: "Salvar" });

  await expect(cancelar.locator("svg")).toHaveCount(1);
  await expect(salvar.locator("svg")).toHaveCount(1);
  // Ícone é rótulo, não vetor: vem antes do texto — childNodes[0] prova a
  // ordem, e não só a presença (raciocínio completo no teste da paginação
  // em visual.spec.ts).
  expect(
    await cancelar.evaluate((b) => b.childNodes[0]?.nodeName.toLowerCase()),
  ).toBe("svg");
  expect(
    await salvar.evaluate((b) => b.childNodes[0]?.nodeName.toLowerCase()),
  ).toBe("svg");
});

// O tip ao vivo é aviso de conveniência, não alerta: `role="alert"` é
// assertivo e interrompe o leitor de tela. E o gatilho é ruim — `divergem`
// compara as strings inteiras, então quem digita a confirmação CORRETAMENTE
// dispara a divergência no primeiro caractere e continua "divergente" até a
// última letra. Interromper para afirmar algo que é falso a maior parte do
// tempo é o pior par possível.
test("o tip ao vivo é polido; o erro de envio continua assertivo", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);

  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-compri");

  const tip = modal.getByText("A confirmação não confere.");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute("role", "status");

  // E continua vermelho: o que muda é a etiqueta ARIA, não a aparência.
  await expect(tip).toHaveCSS("color", "rgb(229, 72, 77)");

  // Depois do envio, a mesma frase é erro de verdade e volta a ser alerta.
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByRole("button", { name: "Salvar" }).click();
  await expect(
    modal.getByRole("alert").filter({ hasText: "A confirmação não confere." }),
  ).toBeVisible();
});

// Cancelar com a requisição em voo: fechar() limpa o estado, mas o catch
// escreve depois que ele rodou. As senhas somem e a mensagem de erro fica
// guardada para a próxima abertura.
test("cancelar com a requisição em voo não guarda o erro para a próxima abertura", async ({
  page,
}) => {
  // A rota fica pendurada até o teste soltar, em vez de dormir um tanto fixo:
  // é o teste que decide quando a resposta chega, então "em voo" é fato e não
  // aposta no relógio — mesma técnica do caso logo abaixo.
  let liberar: (() => void) | undefined;
  await page.route("**/admin/auth/senha", async (rota) => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return rota.fulfill({ status: 400, json: { error: "senha_atual_incorreta" } });
  });

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("qualquer-coisa-comprida");
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();
  // A requisição saiu e está presa no handler — só o teste a libera.
  await expect.poll(() => liberar !== undefined).toBe(true);

  await modal.getByRole("button", { name: "Cancelar" }).click();

  // A resposta chega agora, com o modal já fechado. `finished()` espera o
  // corpo inteiro chegar à página, e não só o cabeçalho: depois dele a volta
  // do `fetch` — e o `catch` que escreveria o erro — já está na fila da
  // página, antes de qualquer coisa que este teste faça a seguir.
  liberar?.();
  const resposta = await page.waitForResponse(
    (res) => res.url().includes("/admin/auth/senha") && res.status() === 400,
  );
  await resposta.finished();

  await page.getByRole("button", { name: "Trocar senha" }).click();
  const reaberto = page.getByRole("dialog");
  await expect(reaberto.getByText("Senha atual incorreta.")).toHaveCount(0);
});

// Falha de rede não tem campo culpado, então vira o erro do diálogo. Como os
// erros de campo, ele precisa sair quando a pessoa começa a corrigir — senão
// fica na tela enquanto ela reescreve tudo.
test("o erro geral some ao voltar a digitar", async ({ page }) => {
  await page.route("**/admin/auth/senha", (rota) => rota.abort());

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  const geral = modal.getByRole("alert").filter({ hasText: /não foi possível falar/i });
  await expect(geral).toBeVisible();

  await modal.getByLabel("Senha atual").fill(`${SENHA}x`);
  await expect(geral).toHaveCount(0);
});

// Achado da revisão da Task 7: um booleano único não tem identidade por
// requisição. Cancelar A e reenviar antes de A responder faz o catch de A
// enxergar o reenvio (B) como "não descartado" — escreve o erro velho de A
// por cima do estado de B, e o finally de A destrava o botão com B ainda em
// voo. O contador de geração corrige isso: a resposta de A só mexe no
// estado se ainda for a requisição mais recente.
test("resposta atrasada de uma requisição cancelada não atrapalha o envio seguinte", async ({
  page,
}) => {
  let liberarA: (() => void) | undefined;
  let liberarB: (() => void) | undefined;
  let chamadas = 0;
  await page.route("**/admin/auth/senha", async (rota) => {
    chamadas += 1;
    if (chamadas === 1) {
      await new Promise<void>((resolve) => {
        liberarA = resolve;
      });
      return rota.fulfill({ status: 400, json: { error: "senha_atual_incorreta" } });
    }
    await new Promise<void>((resolve) => {
      liberarB = resolve;
    });
    return rota.fulfill({ status: 200, json: { ok: true } });
  });

  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("qualquer-coisa-comprida");
  await modal.getByLabel("Nova senha", { exact: true }).fill("nova-senha-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();
  // A saiu e está pendurada em liberarA — só o teste a libera.
  await expect.poll(() => chamadas).toBe(1);

  await modal.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: "Trocar senha" }).click();
  const reaberto = page.getByRole("dialog");
  await reaberto.getByLabel("Senha atual").fill(SENHA);
  await reaberto.getByLabel("Nova senha", { exact: true }).fill("outra-senha-comprida");
  await reaberto.getByLabel("Confirme a nova senha").fill("outra-senha-comprida");
  await reaberto.getByRole("button", { name: "Salvar" }).click();
  // B saiu e está pendurada em liberarB — A continua pendurada também.
  await expect.poll(() => chamadas).toBe(2);

  // A responde agora, com B ainda em voo. Se a resposta de A mexesse no
  // estado, o erro dela apareceria aqui e o botão destravaria antes da hora.
  // O seletor não pode ser pelo nome acessível "Salvar": em carregando o
  // texto do próprio botão vira "Aguarde…", e é exatamente isso que este
  // teste precisa continuar enxergando.
  const botaoSalvar = reaberto.locator('button[type="submit"]');
  liberarA?.();
  // Ausência não dá para flagrar no primeiro poll: se checar agora, o
  // catch/finally de A ainda pode não ter rodado, e a asserção passaria por
  // sorte antes do bug aparecer. Espera a resposta chegar de verdade e o
  // catch/finally terem a chance de rodar antes de confirmar que nada mudou.
  await page.waitForResponse(
    (res) => res.url().includes("/admin/auth/senha") && res.status() === 400,
  );
  await page.waitForTimeout(300);
  await expect(reaberto.getByText("Senha atual incorreta.")).toHaveCount(0);
  await expect(botaoSalvar).toHaveText("Aguarde…");

  // B responde por último, e é a resposta dela que conta.
  liberarB?.();
  await expect(page.getByText("Senha trocada.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// Com a Nova senha vazia, a divergência é consequência, não causa: acusar
// "A confirmação não confere." manda a pessoa olhar para o campo certo pelo
// motivo errado, e o campo que precisa de conteúdo é o de cima.
test("com a Nova senha vazia, o erro é dela — não da confirmação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Confirme a nova senha").fill("nova-senha-comprida");
  await modal.getByRole("button", { name: "Salvar" }).click();

  await expect(modal.getByText("Informe a nova senha.")).toBeVisible();
  await expect(modal.getByText("A confirmação não confere.")).toHaveCount(0);
});

// A mensagem do servidor enuncia a regra que a pessoa precisa cumprir, e
// sumia justamente quando ela começava a cumpri-la.
test("a exigência de tamanho do servidor sobrevive à digitação", async ({
  page,
}) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill(SENHA);
  await modal.getByLabel("Nova senha", { exact: true }).fill("curta12345");
  await modal.getByLabel("Confirme a nova senha").fill("curta12345");
  await modal.getByRole("button", { name: "Salvar" }).click();

  const exigencia = modal.getByText(
    "A senha precisa ter pelo menos 12 caracteres.",
  );
  await expect(exigencia).toBeVisible();

  // Digitar mais um caractere não faz a regra desaparecer da tela.
  await modal.getByLabel("Nova senha", { exact: true }).fill("curta123456");
  await expect(exigencia).toBeVisible();
});

// A marca de origem do erro pertence ao envio, não sobrevive a ele: depois
// de um weak_password do servidor, esvaziar "Nova senha" e reenviar troca a
// origem do erro para local — e um erro local precisa voltar a sumir ao
// digitar, mesmo com a marca do envio anterior ainda no ref.
test("depois do weak_password, um novo erro local volta a sumir ao digitar", async ({
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

  // Esvazia "Nova senha" e reenvia: a validação local barra antes de ir ao
  // servidor, e o erro que aparece agora é de origem local.
  await modal.getByLabel("Nova senha", { exact: true }).fill("");
  await modal.getByRole("button", { name: "Salvar" }).click();
  const erroLocal = modal.getByText("Informe a nova senha.");
  await expect(erroLocal).toBeVisible();

  // Digitar é o que corrige um erro local — precisa sumir.
  await modal.getByLabel("Nova senha", { exact: true }).fill("q");
  await expect(erroLocal).toHaveCount(0);
});

// Reabrir precisa mostrar os campos limpos. É comportamento que fechar() já
// tem, e que ninguém provava — se ele se perder num refactor, o vazamento é
// de senha digitada entre duas aberturas.
test("reabrir o modal mostra os três campos limpos", async ({ page }) => {
  const modal = await abrirTrocarSenha(page);
  await modal.getByLabel("Senha atual").fill("alguma-coisa-comprida");
  await modal.getByLabel("Nova senha", { exact: true }).fill("outra-coisa-comprida");
  await modal.getByLabel("Confirme a nova senha").fill("mais-uma-coisa-comprida");
  await modal.getByRole("button", { name: "Cancelar" }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole("button", { name: "Trocar senha" }).click();
  const reaberto = page.getByRole("dialog");
  await expect(reaberto.getByLabel("Senha atual")).toHaveValue("");
  await expect(reaberto.getByLabel("Nova senha", { exact: true })).toHaveValue("");
  await expect(reaberto.getByLabel("Confirme a nova senha")).toHaveValue("");
});

// O `required` saiu para tirar o balão nativo do navegador; o aria-required
// ficou porque a informação para leitor de tela é legítima e não tem nada a
// ver com a aparência. Sem teste, a segunda metade se perde na primeira vez
// que alguém "limpar" os atributos.
test("os três campos declaram aria-required", async ({ page }) => {
  const modal = await abrirTrocarSenha(page);

  for (const rotulo of ["Senha atual", "Confirme a nova senha"]) {
    await expect(modal.getByLabel(rotulo)).toHaveAttribute("aria-required", "true");
  }
  await expect(
    modal.getByLabel("Nova senha", { exact: true }),
  ).toHaveAttribute("aria-required", "true");
});
