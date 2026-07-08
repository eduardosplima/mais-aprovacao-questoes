import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: migrations,
          JWT_SECRET: "test-jwt-secret",
          COOKIE_SIGNING_KEY: "test-cookie-key",
          ADMIN_EMAILS: "admin@test.com",
          HOTMART_CLIENT_ID: "cid",
          HOTMART_CLIENT_SECRET: "csecret",
          HOTMART_REDIRECT_URI: "https://app.test/auth/callback",
          HOTMART_AUTHORIZE_URL: "https://hotmart.test/authorize",
          HOTMART_TOKEN_URL: "https://hotmart.test/token",
          HOTMART_USERINFO_URL: "https://hotmart.test/userinfo",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
