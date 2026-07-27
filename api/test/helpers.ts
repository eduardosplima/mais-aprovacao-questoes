import { env } from "cloudflare:test";
import { vi } from "vitest";
import type { EmailMessage, EmailSender } from "../src/config/env";

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Coleta as mensagens em memória no lugar do binding send_email. */
export function fakeEmailSender(): { sent: EmailMessage[]; sender: EmailSender } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sender: {
      async send(message: EmailMessage) {
        sent.push(message);
        return { ok: true };
      },
    },
  };
}

/** Env de teste com overrides — é assim que o EMAIL fake entra. */
export function envWith<T extends Record<string, unknown>>(
  overrides: T,
): Cloudflare.Env & T {
  return { ...env, ...overrides } as Cloudflare.Env & T;
}

/**
 * Lê um Set-Cookie específico. `headers.get("set-cookie")` junta múltiplos
 * valores com ", ", ambíguo com as vírgulas dentro dos atributos do cookie;
 * getSetCookie() devolve cada valor intacto. Existe em runtime (Workers/undici)
 * mas não no tipo Headers do @cloudflare/workers-types, daí o cast.
 */
export function cookieFrom(res: Response, name: string): string | null {
  const all = (
    res.headers as unknown as { getSetCookie(): string[] }
  ).getSetCookie();
  const match = all.find((c) => c.startsWith(name + "="));
  return match ? match.split(";")[0].trim() : null;
}

/** Stub do siteverify. Chame `vi.unstubAllGlobals()` no afterEach. */
export function stubTurnstile(success: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === TURNSTILE_URL) {
        return new Response(JSON.stringify({ success }), { status: 200 });
      }
      throw new Error("fetch inesperado: " + String(input));
    }),
  );
}
