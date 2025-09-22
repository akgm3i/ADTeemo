import { z } from "zod";

const RSO_PROVIDER_URL = "https://auth.riotgames.com";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string().optional(),
});

const userInfoSchema = z.object({
  sub: z.string(),
  // other claims can be added here if needed
});

export const RSO_CALLBACK_PATH = "/auth/rso/callback";

/**
 * Exchanges an authorization code for access, ID, and refresh tokens.
 * @param code The authorization code received from the RSO callback.
 * @returns An object containing the tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const clientId = Deno.env.get("RSO_CLIENT_ID");
  const clientSecret = Deno.env.get("RSO_CLIENT_SECRET");
  const redirectUriBase = Deno.env.get("RSO_REDIRECT_URI");

  if (!clientId || !clientSecret || !redirectUriBase) {
    throw new Error("Riot Sign On environment variables are not set.");
  }

  const tokenUrl = `${RSO_PROVIDER_URL}/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: `${redirectUriBase}${RSO_CALLBACK_PATH}`,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Failed to exchange code for tokens:", errorBody);
    throw new Error("Failed to get tokens from Riot Sign On.");
  }

  const data = await response.json();
  const parsed = tokenResponseSchema.parse(data);

  return {
    accessToken: parsed.access_token,
    idToken: parsed.id_token,
  };
}

/**
 * Fetches user information from the UserInfo endpoint using an access token.
 * @param accessToken The access token obtained from the token endpoint.
 * @returns An object containing user information, including the Riot ID (sub).
 */
export async function getUserInfo(accessToken: string) {
  const userInfoUrl = `${RSO_PROVIDER_URL}/userinfo`;

  const response = await fetch(userInfoUrl, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Failed to fetch user info:", errorBody);
    throw new Error("Failed to get user info from Riot Sign On.");
  }

  const data = await response.json();
  return userInfoSchema.parse(data);
}

export function getAuthorizationUrl(state: string) {
  const clientId = Deno.env.get("RSO_CLIENT_ID");
  const redirectUriBase = Deno.env.get("RSO_REDIRECT_URI");

  if (!clientId || !redirectUriBase) {
    throw new Error("Riot Sign On environment variables are not set.");
  }

  const authUrl = new URL(`${RSO_PROVIDER_URL}/authorize`);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", clientId);
  authUrl.searchParams.append(
    "redirect_uri",
    `${redirectUriBase}${RSO_CALLBACK_PATH}`,
  );
  authUrl.searchParams.append("scope", "openid");
  authUrl.searchParams.append("state", state);

  return authUrl.toString();
}

export const rso = {
  exchangeCodeForTokens,
  getUserInfo,
  getAuthorizationUrl,
};
