/**
 * Comparação em tempo constante. O tamanho não é secreto (vaza pelo early
 * return), o que é o comportamento padrão de `crypto.timingSafeEqual`.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function equalStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return equalBytes(enc.encode(a), enc.encode(b));
}
