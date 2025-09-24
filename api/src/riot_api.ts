import { z } from "zod";

const riotAccountSchema = z.object({
  puuid: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
});

async function getAccountByRiotId(gameName: string, tagLine: string) {
  const apiKey = Deno.env.get("RIOT_API_KEY");
  if (!apiKey) {
    throw new Error("RIOT_API_KEY is not set");
  }

  const url = new URL(
    `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`,
  );
  url.searchParams.append("api_key", apiKey);

  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch account from Riot API: ${res.status}`);
  }

  const data = await res.json();
  return riotAccountSchema.parse(data);
}

export const riotApi = {
  getAccountByRiotId,
};
