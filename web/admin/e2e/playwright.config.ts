import { defineConfig, devices } from "@playwright/test";

/**
 * Dois servidores, porque o painel só é o painel com a API atrás: o
 * `wrangler dev` serve o Worker em 8787 e o `next dev` serve as telas em 3000,
 * reescrevendo /admin/* e /auth/* para o Worker (ver next.config.ts). Do ponto
 * de vista do navegador tudo é localhost:3000 — a mesma origem única que a
 * produção tem, que é o que faz este e2e testar o arranjo real e não um
 * arranjo de mentira com CORS.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false, // um D1 local, um acervo: paralelismo aqui é corrida
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../../../api",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      cwd: "..",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
