import type { DbActions } from "../db/actions.ts";
import {
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
} from "../errors.ts";
import type { opggClient, OpggMatchDetail } from "../integrations/opgg.ts";

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

type EnvReader = {
  get(key: string): string | undefined;
};

type OpggMatchDetailDbActions = Pick<
  DbActions,
  "getRiotAccountByDiscordId" | "upsertExternalMatchDetail"
>;

type Logger = {
  warn(
    message: string,
    metadata?: Record<string, unknown>,
    error?: unknown,
  ): void;
};

export type OpggMatchDetailServiceDependencies = {
  dbActions: OpggMatchDetailDbActions;
  env: EnvReader;
  logger: Logger;
  opggClient: Pick<typeof opggClient, "resolveMatchDetail">;
};

export type OpggMatchDetailService = {
  resolveAndSave(
    input: ResolveAndSaveOpggMatchDetailInput,
  ): Promise<OpggMatchDetail | null>;
};

function booleanEnv(env: EnvReader, name: string) {
  const value = env.get(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" ||
    value === "on";
}

async function resolveAndSave(
  deps: OpggMatchDetailServiceDependencies,
  input: ResolveAndSaveOpggMatchDetailInput,
) {
  if (!booleanEnv(deps.env, "OPGG_ENABLED")) return null;

  const account = await deps.dbActions.getRiotAccountByDiscordId(
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
    detail = await deps.opggClient.resolveMatchDetail(account, {
      metadata: { matchId: input.matchId },
      info: {
        gameCreation: input.match.gameCreation,
        gameDuration: input.match.gameDuration,
        queueId: input.match.queueId,
        participants: [input.match.participant],
      },
    });
  } catch (error) {
    deps.logger.warn("opgg_match_detail.resolve_failed", {
      targetDiscordId: input.targetDiscordId,
      matchId: input.matchId,
    }, error);
    return null;
  }

  if (!detail) return null;

  await deps.dbActions.upsertExternalMatchDetail({
    matchId: input.matchId,
    ...detail,
  });
  return detail;
}

export function createOpggMatchDetailService(
  deps: OpggMatchDetailServiceDependencies,
): OpggMatchDetailService {
  return {
    resolveAndSave: (input) => resolveAndSave(deps, input),
  };
}
