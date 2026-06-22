import { dbActions } from "../db/actions.ts";
import {
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
} from "../errors.ts";
import { opggClient } from "../integrations/opgg.ts";
import { apiLogger } from "../logger.ts";

export type ResolveAndSaveOpggMatchDetailInput = {
  matchId: string;
  targetDiscordId: string;
  match: {
    gameCreation: number;
    gameDuration: number;
    queueId: number;
    participant: {
      puuid: string;
      championId?: number;
      championName?: string;
    };
  };
};

function booleanEnv(name: string) {
  const value = Deno.env.get(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" ||
    value === "on";
}

export async function resolveAndSaveOpggMatchDetail(
  input: ResolveAndSaveOpggMatchDetailInput,
) {
  if (!booleanEnv("OPGG_ENABLED")) return null;

  const account = await dbActions.getRiotAccountByDiscordId(
    input.targetDiscordId,
  );
  if (!account) {
    throw new RecordNotFoundError(
      `Riot account not found for Discord user ${input.targetDiscordId}`,
    );
  }
  if (account.puuid !== input.match.participant.puuid) {
    throw new OpggMatchParticipantMismatchError(
      `Match participant does not belong to Discord user ${input.targetDiscordId}`,
    );
  }

  let detail;
  try {
    detail = await opggClient.resolveMatchDetail(account, {
      metadata: { matchId: input.matchId },
      info: {
        gameCreation: input.match.gameCreation,
        gameDuration: input.match.gameDuration,
        queueId: input.match.queueId,
        participants: [input.match.participant],
      },
    });
  } catch (error) {
    apiLogger.warn("opgg_match_detail.resolve_failed", {
      targetDiscordId: input.targetDiscordId,
      matchId: input.matchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!detail) return null;

  await dbActions.upsertExternalMatchDetail({
    matchId: input.matchId,
    ...detail,
  });
  return detail;
}

export const opggMatchDetailService = {
  resolveAndSave: resolveAndSaveOpggMatchDetail,
};
