import { OAUTH_HOST } from "./client";
import type { BattleNetUser } from "./types";

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** `wow.profile` lets us list the user's characters so they are claimed automatically. */
export const OAUTH_SCOPES = ["openid", "wow.profile"];

export function authorizeUrl(config: OAuthAppConfig, state: string): string {
  const url = new URL("/authorize", OAUTH_HOST);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(config: OAuthAppConfig, code: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${OAUTH_HOST}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new Error(`Battle.net token exchange failed (${response.status})`);
  return (await response.json()) as { access_token: string; expires_in: number };
}

export async function getUserInfo(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<BattleNetUser> {
  const response = await fetchImpl(`${OAUTH_HOST}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Battle.net userinfo failed (${response.status})`);
  const body = (await response.json()) as { id: number; battletag: string };
  return { id: body.id, battletag: body.battletag };
}
