/**
 * Higieniza texto livre de terceiros (nome digitado no checkout da Hotmart,
 * ou devolvido pela API de dados) ANTES de persistir. `lib/email.ts` escapa
 * HTML na renderização, mas o corpo `text/plain` não escapa nada — sem isto,
 * um nome multi-linha vira parágrafos arbitrários (e uma URL de phishing)
 * entregues para quem quer que seja o dono do email da compra.
 */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
