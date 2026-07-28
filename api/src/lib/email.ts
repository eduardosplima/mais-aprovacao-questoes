import type { Env } from "../config/env";

export type MagicLinkKind = "first_access" | "recovery";

/**
 * `name` vem do checkout da Hotmart — texto livre digitado pelo comprador,
 * não confiável. Sem isto, um comprador poderia injetar HTML no corpo do
 * email enviado à vítima (o email do comprador não precisa ser o dele).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface MagicLinkParams {
  to: string;
  name: string | null;
  token: string;
  kind: MagicLinkKind;
}

const COPY: Record<MagicLinkKind, { subject: string; intro: string }> = {
  first_access: {
    subject: "Seu acesso ao Mais Aprovação",
    intro:
      "Sua assinatura foi confirmada. Use o link abaixo para definir sua senha e começar a estudar.",
  },
  recovery: {
    subject: "Recuperação de acesso — Mais Aprovação",
    intro:
      "Recebemos um pedido de recuperação de acesso. Use o link abaixo para definir uma nova senha.",
  },
};

const EXPIRY_NOTE: Record<MagicLinkKind, string> = {
  first_access: "Este link vale por 48 horas e só pode ser usado uma vez.",
  recovery: "Este link vale por 1 hora e só pode ser usado uma vez.",
};

export async function sendMagicLink(
  env: Env,
  params: MagicLinkParams,
): Promise<void> {
  const url = `${env.APP_BASE_URL}/definir-senha?token=${encodeURIComponent(params.token)}`;
  const greeting = params.name ? `Olá, ${params.name}!` : "Olá!";
  const copy = COPY[params.kind];
  const expiry = EXPIRY_NOTE[params.kind];

  const text = [
    greeting,
    "",
    copy.intro,
    "",
    url,
    "",
    expiry,
    "Se não foi você, ignore este email.",
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${copy.intro}</p>`,
    `<p><a href="${url}">Definir minha senha</a></p>`,
    `<p>Se o botão não funcionar, copie e cole este endereço no navegador:<br>${url}</p>`,
    `<p><small>${expiry} Se não foi você, ignore este email.</small></p>`,
  ].join("\n");

  await env.EMAIL.send({
    to: params.to,
    from: env.EMAIL_FROM,
    subject: copy.subject,
    html,
    text,
  });
}
