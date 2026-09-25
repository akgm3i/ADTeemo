import { z } from "zod";
import type { RiotRegion } from "./contract/domain.ts";

const RSO_PROVIDER_URL = "https://auth.riotgames.com";
export const RSO_CALLBACK_PATH = "/auth/rso/callback";
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().optional(),
});
const accountResponseSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});

export class RsoProviderError extends Error {
  constructor(
    readonly operation: "token" | "account",
    readonly status?: number,
  ) {
    super(
      `Riot Sign On ${operation} request failed${
        status === undefined ? "" : ` (HTTP ${status})`
      }`,
    );
    this.name = "RsoProviderError";
  }
}

async function providerJson(
  operation: "token" | "account",
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new RsoProviderError(operation);
  }
  if (!response.ok) throw new RsoProviderError(operation, response.status);
  try {
    return await response.json();
  } catch {
    throw new RsoProviderError(operation, response.status);
  }
}

function rsoConfiguration() {
  const clientId = Deno.env.get("RSO_CLIENT_ID");
  const clientSecret = Deno.env.get("RSO_CLIENT_SECRET");
  const redirectUriBase = Deno.env.get("RSO_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUriBase) {
    throw new Error("Riot Sign On environment variables are not set.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${redirectUriBase.replace(/\/$/, "")}${RSO_CALLBACK_PATH}`,
  };
}

export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret, redirectUri } = rsoConfiguration();
  const data = await providerJson("token", `${RSO_PROVIDER_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const parsed = tokenResponseSchema.safeParse(data);
  if (!parsed.success) throw new RsoProviderError("token");
  return {
    accessToken: parsed.data.access_token,
    idToken: parsed.data.id_token,
  };
}

/** Account-v1 /accounts/me is the authority for PUUID and display Riot ID. */
export async function getAccount(accessToken: string, region: RiotRegion) {
  const data = await providerJson(
    "account",
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/me`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const parsed = accountResponseSchema.safeParse(data);
  if (!parsed.success) throw new RsoProviderError("account");
  return parsed.data;
}

export function getAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = rsoConfiguration();
  const url = new URL(`${RSO_PROVIDER_URL}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  return url.toString();
}

export const rso = { exchangeCodeForTokens, getAccount, getAuthorizationUrl };
