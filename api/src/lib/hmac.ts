export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeDocument(raw: string): string {
  return raw.replace(/\D/g, "");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HMAC-SHA256 em hex. Usado para documento e para o email da tombstone.
 * A chave é um pepper em secret: sem ela, um dump do banco não permite
 * ataque de dicionário (um CPF tem só ~10^9 candidatos válidos).
 */
export async function hmacHex(value: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(value));
  return toHex(sig);
}
