import { expect, type Page } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";

/**
 * Entra no painel do jeito que o operador entra. Um lugar só, porque seis
 * specs precisam disto como pré-condição.
 *
 * `login.spec.ts` e o primeiro teste de `caminho-critico.spec.ts` NÃO usam
 * este helper de propósito: nesses dois o login é o objeto do teste, não a
 * pré-condição — se ele mudar, quero ver o teste do login falhar, não o
 * helper esconder a mudança.
 */
export async function entrar(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
}
