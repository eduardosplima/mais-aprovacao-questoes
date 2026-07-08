import type { Env } from "../config/env";
import type { HotmartIdentity } from "../db/users";

export interface HotmartClient {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  fetchIdentity(accessToken: string): Promise<HotmartIdentity>;
}

export function createHotmartClient(env: Env): HotmartClient {
  return {
    authorizeUrl(state) {
      const u = new URL(env.HOTMART_AUTHORIZE_URL);
      u.searchParams.set("client_id", env.HOTMART_CLIENT_ID);
      u.searchParams.set("redirect_uri", env.HOTMART_REDIRECT_URI);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("state", state);
      return u.toString();
    },

    async exchangeCode(code) {
      const res = await fetch(env.HOTMART_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.HOTMART_CLIENT_ID,
          client_secret: env.HOTMART_CLIENT_SECRET,
          redirect_uri: env.HOTMART_REDIRECT_URI,
        }),
      });
      if (!res.ok) throw new Error(`token exchange falhou: ${res.status}`);
      const data = (await res.json()) as { access_token: string };
      return { accessToken: data.access_token };
    },

    async fetchIdentity(accessToken) {
      const res = await fetch(env.HOTMART_USERINFO_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`identidade falhou: ${res.status}`);
      const data = (await res.json()) as {
        id?: string | number;
        user_id?: string | number;
        email: string;
      };
      return {
        hotmartUserId: String(data.id ?? data.user_id ?? ""),
        email: data.email,
      };
    },
  };
}
