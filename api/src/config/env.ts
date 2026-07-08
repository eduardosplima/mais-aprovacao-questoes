import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  COOKIE_SIGNING_KEY: string;
  ADMIN_EMAILS: string;
  HOTMART_CLIENT_ID: string;
  HOTMART_CLIENT_SECRET: string;
  HOTMART_REDIRECT_URI: string;
  HOTMART_AUTHORIZE_URL: string;
  HOTMART_TOKEN_URL: string;
  HOTMART_USERINFO_URL: string;
}

export function getAdminEmails(env: Env): string[] {
  return env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
