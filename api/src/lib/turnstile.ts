import type { Env } from "../config/env";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Metade server-side do Turnstile. O widget é frontend (sub-projeto 4), mas a
 * verificação mora aqui — é ela que protege login e recuperação de força bruta.
 *
 * Fail-closed: qualquer falha (rede, HTTP, JSON) responde false.
 */
export async function verifyTurnstile(
  env: Env,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
