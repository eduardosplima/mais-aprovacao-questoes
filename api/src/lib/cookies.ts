import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const SESSION = "session";
/** Nome próprio: em dev os dois frontends dividem localhost. */
const ADMIN_SESSION = "sessao_admin";
const DOZE_HORAS = 60 * 60 * 12;

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

export function setAdminSessionCookie(c: Context, token: string): void {
  setCookie(c, ADMIN_SESSION, token, { ...base, maxAge: DOZE_HORAS });
}

export function getAdminSessionCookie(c: Context): string | undefined {
  return getCookie(c, ADMIN_SESSION);
}

export function clearAdminSessionCookie(c: Context): void {
  deleteCookie(c, ADMIN_SESSION, { path: "/" });
}
