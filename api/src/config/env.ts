import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

/** Uma mensagem para o Cloudflare Email Sending. */
export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * O binding `send_email`. Declarado como interface nossa (e não com o tipo
 * `SendEmail` do Cloudflare) para que os testes possam injetar um fake via
 * `{ ...env, EMAIL: fake }` sem depender de suporte do Miniflare.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  EMAIL: EmailSender;
  JWT_SECRET: string;
  HOTMART_HOTTOK: string;
  HOTMART_CLIENT_ID: string;
  HOTMART_CLIENT_SECRET: string;
  DOCUMENT_HMAC_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  HOTMART_SUBSCRIPTION_UCODES: string;
  HOTMART_API_BASE_URL: string;
  HOTMART_TOKEN_URL: string;
  HOTMART_CHECKOUT_URL: string;
  APP_BASE_URL: string;
  EMAIL_FROM: string;
  ADMIN_EMAILS: string;
  /** Domínio do time no Zero Trust, ex.: "minhaequipe.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Tag `aud` da aplicação Access. Dashboard → Access → Applications. */
  ACCESS_AUD: string;
  /**
   * Só existe em `.dev.vars`. Fail-closed: qualquer valor diferente de "true"
   * — inclusive ausência — significa exigir o JWT do Access.
   */
  ACCESS_DEV_BYPASS?: string;
  /** Bucket das imagens de questão. Servido por um hostname sem cookies. */
  MEDIA: R2Bucket;
  /** Base pública do bucket, ex.: "https://media.exemplo.com". Sem barra final. */
  MEDIA_PUBLIC_BASE: string;
}

function csv(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getAdminEmails(env: Env): string[] {
  return csv(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
}

export function getSubscriptionUcodes(env: Env): string[] {
  return csv(env.HOTMART_SUBSCRIPTION_UCODES);
}
