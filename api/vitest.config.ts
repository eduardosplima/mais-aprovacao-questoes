import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        r2Buckets: ["MEDIA"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          JWT_SECRET: "test-jwt-secret",
          HOTMART_HOTTOK: "test-hottok",
          HOTMART_CLIENT_ID: "cid",
          HOTMART_CLIENT_SECRET: "csecret",
          DOCUMENT_HMAC_KEY: "test-hmac-key",
          TURNSTILE_SECRET_KEY: "test-turnstile-secret",
          HOTMART_SUBSCRIPTION_UCODES: "UCODE_ASSINATURA,UCODE_ANUAL",
          HOTMART_API_BASE_URL: "https://hotmart.test",
          HOTMART_TOKEN_URL: "https://hotmart.test/token",
          HOTMART_CHECKOUT_URL: "https://pay.hotmart.test/produto",
          APP_BASE_URL: "https://app.test",
          EMAIL_FROM: "nao-responda@app.test",
          ADMIN_EMAILS: "admin@test.com",
          ACCESS_TEAM_DOMAIN: "equipe-test.cloudflareaccess.com",
          ACCESS_AUD: "aud-de-teste",
          ACCESS_DEV_BYPASS: "",
          MEDIA_PUBLIC_BASE: "https://media.test",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
