import { defineConfig, devices } from "@playwright/test";

/**
 * Dois servidores, porque o painel só é o painel com a API atrás: o
 * `wrangler dev` serve o Worker em 8787 e o `next dev` serve as telas em 3000,
 * reescrevendo /admin/* e /auth/* para o Worker (ver next.config.ts). Do ponto
 * de vista do navegador tudo é localhost:3000 — a mesma origem única que a
 * produção tem, que é o que faz este e2e testar o arranjo real e não um
 * arranjo de mentira com CORS.
 *
 * O 3000 é https aqui, e só aqui — `npm run dev` continua em http. O motivo é
 * o WebKit: o cookie de sessão é `Secure` (api/src/lib/cookies.ts:8) e o
 * WebKit o descarta quando chega por http, mesmo em localhost, ao contrário do
 * Chromium. Servir a suíte por TLS é o que permite testar o Safari sem abrir
 * exceção no cookie — o `secure: true` exercitado aqui é exatamente o de
 * produção. O certificado é gerado por `e2e/certificado.mjs`; como é
 * auto-assinado, `ignoreHTTPSErrors` precisa estar ligado nos dois lugares
 * abaixo (no navegador e na sondagem que o Playwright faz para saber que o
 * servidor subiu).
 *
 * O 8787 segue em http de propósito — o navegador nunca fala com ele. Quem
 * chama é o proxy do `next dev`, do lado do servidor.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false, // um D1 local, um acervo: paralelismo aqui é corrida
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "https://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../../../api",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev:e2e",
      cwd: "..",
      url: "https://localhost:3000/login",
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
