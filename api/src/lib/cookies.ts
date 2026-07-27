import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const SESSION = "session";

const base = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION, token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION, { path: "/" });
}
