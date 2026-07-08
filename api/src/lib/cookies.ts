import type { Context } from "hono";
import {
  getCookie,
  getSignedCookie,
  setCookie,
  setSignedCookie,
  deleteCookie,
} from "hono/cookie";

const SESSION = "session";
const STATE = "oauth_state";

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

export async function setStateCookie(
  c: Context,
  state: string,
  signingKey: string,
): Promise<void> {
  await setSignedCookie(c, STATE, state, signingKey, {
    ...base,
    maxAge: 600,
  });
}

export function getStateCookie(
  c: Context,
  signingKey: string,
): Promise<string | false | undefined> {
  return getSignedCookie(c, signingKey, STATE);
}

export function clearStateCookie(c: Context): void {
  deleteCookie(c, STATE, { path: "/" });
}
