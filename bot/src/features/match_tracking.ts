import { type Client, EmbedBuilder } from "discord.js";
import type { Lane, MatchWatcher, RiotAccount } from "@adteemo/api/schema";
import { riotApi } from "@adteemo/api/riot-api";
import { riotStaticData } from "@adteemo/api/riot-static-data";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS = 300_000;
const DEFAULT_RESULT_FETCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DEFAULT_RIOT_LONG_WINDOW_LIMIT = 30_000;
const RIOT_LONG_WINDOW_MS = 10 * 60 * 1000;

type ActiveGame = NonNullable<
  Awaited<ReturnType<typeof riotApi.getActiveGameByPuuid>>
>;
type ActiveGameResult = Awaited<
  ReturnType<typeof riotApi.getActiveGameByPuuid>
>;
type RiotAccountResult = Awaited<ReturnType<typeof apiClient.getRiotAccount>>;
type RiotMatch = NonNullable<Awaited<ReturnType<typeof riotApi.getMatchById>>>;
type WatcherState = Parameters<typeof apiClient.updateMatchWatcherState>[2];
type MatchWatcherProcessingContext = {
  riotAccountsByTargetDiscordId: Map<string, Promise<RiotAccountResult>>;
  activeGamesByRiotAccount: Map<string, Promise<ActiveGameResult>>;
  matchesByRegionAndMatchId: Map<string, Promise<RiotMatch | null>>;
};
type WatcherMessage = {
  id?: string;
  edit?: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};
type WatcherChannel = {
  send?: (options: { embeds: EmbedBuilder[] }) => Promise<WatcherMessage>;
  messages?: {
    fetch?: (messageId: string) => Promise<WatcherMessage>;
  };
};
type PendingResult = {
  matchId: string;
  messageId: string | null;
  startedAt: Date | null;
};

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function matchIdForGame(account: RiotAccount, gameId: string | number) {
  return `${account.platform.toUpperCase()}_${gameId}`;
}

function activeGameCacheKey(account: RiotAccount) {
  return `${account.platform}:${account.puuid}`;
}

function matchCacheKey(account: RiotAccount, matchId: string) {
  return `${account.region}:${matchId}`;
}

function createMatchWatcherProcessingContext(): MatchWatcherProcessingContext {
  return {
    riotAccountsByTargetDiscordId: new Map(),
    activeGamesByRiotAccount: new Map(),
    matchesByRegionAndMatchId: new Map(),
  };
}

function getRiotAccountForWatcher(
  context: MatchWatcherProcessingContext,
  targetDiscordId: string,
) {
  const cached = context.riotAccountsByTargetDiscordId.get(targetDiscordId);
  if (cached) return cached;

  const result = apiClient.getRiotAccount(targetDiscordId);
  context.riotAccountsByTargetDiscordId.set(targetDiscordId, result);
  return result;
}

function getActiveGameForAccount(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
) {
  const cacheKey = activeGameCacheKey(account);
  const cached = context.activeGamesByRiotAccount.get(cacheKey);
  if (cached) return cached;

  const result = riotApi.getActiveGameByPuuid(account.platform, account.puuid);
  context.activeGamesByRiotAccount.set(cacheKey, result);
  return result;
}

function getMatchForPendingResult(
  context: MatchWatcherProcessingContext,
  account: RiotAccount,
  matchId: string,
) {
  const cacheKey = matchCacheKey(account, matchId);
  const cached = context.matchesByRegionAndMatchId.get(cacheKey);
  if (cached) return cached;

  const result = riotApi.getMatchById(account.region, matchId);
  context.matchesByRegionAndMatchId.set(cacheKey, result);
  return result;
}

function elapsedMinutes(activeGame: ActiveGame, now = Date.now()) {
  const currentLengthMs = (activeGame.gameLength ?? 0) * 1000;
  const elapsedMs = activeGame.gameStartTime > 0
    ? Math.max(now - activeGame.gameStartTime, currentLengthMs)
    : currentLengthMs;
  return Math.max(0, Math.floor(elapsedMs / 60_000));
}

function shouldNotifyInGame(
  watcher: MatchWatcher,
  intervalMs = numberEnv(
    "MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS",
    DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS,
  ),
  now = new Date(),
) {
  if (!watcher.lastInGameNotifiedAt) return true;
  return now.getTime() - watcher.lastInGameNotifiedAt.getTime() >= intervalMs;
}

function hasResultFetchTimedOut(
  watcher: MatchWatcher,
  timeoutMs = numberEnv(
    "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
    DEFAULT_RESULT_FETCH_TIMEOUT_MS,
  ),
  now = new Date(),
) {
  const startedAt = watcher.pendingResultStartedAt ?? watcher.gameStartedAt;
  if (!startedAt) return false;
  return isResultFetchTimedOut(startedAt, timeoutMs, now);
}

function isResultFetchTimedOut(
  startedAt: Date,
  timeoutMs = numberEnv(
    "MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS",
    DEFAULT_RESULT_FETCH_TIMEOUT_MS,
  ),
  now = new Date(),
) {
  return now.getTime() - startedAt.getTime() >= timeoutMs;
}

async function championNameById(championId: number | undefined) {
  if (championId === undefined) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.unknownChampion,
    );
  }
  return await riotStaticData.getChampionNameById(championId) ??
    messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.championId,
      { id: championId },
    );
}

async function queueName(queueId: number | undefined) {
  if (queueId === undefined) {
    return messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.unknownQueue,
    );
  }
  return await riotStaticData.getQueueNameById(queueId) ??
    messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.queueId,
      { id: queueId },
    );
}

async function mapName(mapId: number) {
  return await riotStaticData.getMapNameById(mapId) ??
    messageHandler.formatMessage(
      messageKeys.matchTracking.embed.fallback.mapId,
      { id: mapId },
    );
}

async function gameModeName(gameMode: string) {
  return await riotStaticData.getGameModeName(gameMode) ?? gameMode;
}

function formatCsPerMinute(cs: number, gameDurationSeconds: number) {
  if (!Number.isFinite(cs) || !Number.isFinite(gameDurationSeconds)) return "-";
  if (cs < 0 || gameDurationSeconds <= 0) return "-";
  return (cs / (gameDurationSeconds / 60)).toFixed(1);
}

function formatKillParticipation(
  participantKills: number,
  participantAssists: number,
  teamKills: number,
) {
  if (
    !Number.isFinite(participantKills) ||
    !Number.isFinite(participantAssists) ||
    !Number.isFinite(teamKills) ||
    participantKills < 0 ||
    participantAssists < 0 ||
    teamKills <= 0
  ) {
    return "-";
  }
  return `${
    (((participantKills + participantAssists) / teamKills) * 100).toFixed(1)
  }%`;
}

function currentStateFromWatcher(watcher: MatchWatcher): WatcherState {
  return {
    lastState: watcher.lastState === "FETCHING_RESULT"
      ? "IDLE"
      : watcher.lastState,
    currentGameId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentGameId,
    currentMatchId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentMatchId,
    currentNotificationMessageId: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.currentNotificationMessageId,
    gameStartedAt: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.gameStartedAt,
    lastInGameNotifiedAt: watcher.lastState === "FETCHING_RESULT"
      ? null
      : watcher.lastInGameNotifiedAt,
  };
}

function pendingResultFromWatcher(watcher: MatchWatcher): PendingResult | null {
  const matchId = watcher.pendingResultMatchId ??
    (watcher.lastState === "FETCHING_RESULT" ? watcher.currentMatchId : null);
  if (!matchId) return null;
  return {
    matchId,
    messageId: watcher.pendingResultNotificationMessageId ??
      watcher.currentNotificationMessageId,
    startedAt: watcher.pendingResultStartedAt ?? watcher.gameStartedAt,
  };
}

async function buildActiveGameEmbed(
  watcher: MatchWatcher,
  account: RiotAccount,
  activeGame: ActiveGame,
  kind: "started" | "progress",
) {
  const participant = activeGame.participants.find((p) =>
    p.puuid === account.puuid
  );
  const minutes = elapsedMinutes(activeGame);
  const champion = await championNameById(participant?.championId);
  const queue = await queueName(activeGame.gameQueueConfigId);
  const map = await mapName(activeGame.mapId);
  const mode = await gameModeName(activeGame.gameMode);
  const title = kind === "started"
    ? messageHandler.formatMessage(
      messageKeys.matchTracking.embed.active.startedTitle,
    )
    : messageHandler.formatMessage(
      messageKeys.matchTracking.embed.active.progressTitle,
    );

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.active.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(kind === "started" ? 0x2ecc71 : 0x3498db)
    .addFields(
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.champion,
        ),
        value: champion,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.queue,
        ),
        value: queue,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.map,
        ),
        value: map,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.mode,
        ),
        value: mode,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.elapsed,
        ),
        value: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.fallback.elapsedMinutes,
          { minutes },
        ),
        inline: true,
      },
    )
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.game,
        {
          platform: account.platform.toUpperCase(),
          gameId: activeGame.gameId,
          riotId: `${account.gameName}#${account.tagLine}`,
        },
      ),
    })
    .setTimestamp(new Date());
}

function buildResultPendingEmbed(watcher: MatchWatcher, matchId: string) {
  return new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultPending.title,
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultPending.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(0xf1c40f)
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId },
      ),
    })
    .setTimestamp(new Date());
}

function buildResultFetchTimeoutEmbed(
  watcher: MatchWatcher,
  matchId: string,
) {
  return new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.title,
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.resultTimeout.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(0x95a5a6)
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.match,
        { matchId },
      ),
    })
    .setTimestamp(new Date());
}

async function buildMatchResultEmbed(
  watcher: MatchWatcher,
  account: RiotAccount,
  match: RiotMatch,
) {
  const participant = match.info.participants.find((p) =>
    p.puuid === account.puuid
  );
  if (!participant) {
    return new EmbedBuilder()
      .setTitle(
        messageHandler.formatMessage(
          messageKeys.matchTracking.embed.result.participantMissingTitle,
        ),
      )
      .setDescription(
        messageHandler.formatMessage(
          messageKeys.matchTracking.embed.result.participantMissingDescription,
          { member: `<@${watcher.targetDiscordId}>` },
        ),
      )
      .setColor(0x95a5a6)
      .setFooter({
        text: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.footer.match,
          { matchId: match.metadata.matchId },
        ),
      })
      .setTimestamp(new Date());
  }

  const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
  const teamKills = match.info.participants
    .filter((candidate) => candidate.teamId === participant.teamId)
    .reduce((sum, candidate) => sum + candidate.kills, 0);
  const csPerMinute = formatCsPerMinute(cs, match.info.gameDuration);
  const killParticipation = formatKillParticipation(
    participant.kills,
    participant.assists,
    teamKills,
  );
  const queue = await queueName(match.info.queueId);
  const map = await mapName(match.info.mapId);
  const result = participant.win
    ? messageHandler.formatMessage(messageKeys.matchTracking.embed.result.win)
    : messageHandler.formatMessage(messageKeys.matchTracking.embed.result.loss);
  return new EmbedBuilder()
    .setTitle(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.title,
        { result },
      ),
    )
    .setDescription(
      messageHandler.formatMessage(
        messageKeys.matchTracking.embed.result.description,
        { member: `<@${watcher.targetDiscordId}>` },
      ),
    )
    .setColor(participant.win ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.champion,
        ),
        value: participant.championName,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.kda,
        ),
        value:
          `${participant.kills}/${participant.deaths}/${participant.assists}`,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.cs,
        ),
        value: String(cs),
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.csPerMinute,
        ),
        value: csPerMinute,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.killParticipation,
        ),
        value: killParticipation,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.gold,
        ),
        value: String(participant.goldEarned),
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.queue,
        ),
        value: queue,
        inline: true,
      },
      {
        name: messageHandler.formatMessage(
          messageKeys.matchTracking.embed.field.map,
        ),
        value: map,
        inline: true,
      },
    )
    .setFooter({
      text: messageHandler.formatMessage(
        messageKeys.matchTracking.embed.footer.matchWithRiotId,
        {
          matchId: match.metadata.matchId,
          riotId: `${account.gameName}#${account.tagLine}`,
        },
      ),
    })
    .setTimestamp(new Date(match.info.gameEndTimestamp ?? Date.now()));
}

async function sendOrEditWatcherMessage(
  client: Client,
  watcher: MatchWatcher,
  messageId: string | null | undefined,
  embed: EmbedBuilder,
) {
  try {
    const channel = await client.channels.fetch(watcher.channelId) as
      | WatcherChannel
      | null;
    if (!channel?.send) {
      botLogger.warn("match_tracking.channel_not_found", {
        guildId: watcher.guildId,
        channelId: watcher.channelId,
      });
      return messageId ?? null;
    }

    if (messageId && channel.messages?.fetch) {
      try {
        const message = await channel.messages.fetch(messageId);
        await message.edit?.({ embeds: [embed] });
        return message.id ?? messageId;
      } catch (error) {
        botLogger.warn("match_tracking.edit_message_failed", {
          guildId: watcher.guildId,
          channelId: watcher.channelId,
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const message = await channel.send({ embeds: [embed] });
    return message.id ?? null;
  } catch (error) {
    botLogger.error("match_tracking.send_message_failed", {
      guildId: watcher.guildId,
      channelId: watcher.channelId,
    }, error);
    return messageId ?? null;
  }
}

async function setWatcherState(
  watcher: MatchWatcher,
  state: Parameters<typeof apiClient.updateMatchWatcherState>[2],
) {
  const result = await apiClient.updateMatchWatcherState(
    watcher.guildId,
    watcher.targetDiscordId,
    state,
  );
  if (!result.success) {
    botLogger.error("match_tracking.state_update_failed", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: result.error,
    });
  }
}

async function tryFetchAndNotifyResult(
  client: Client,
  watcher: MatchWatcher,
  account: RiotAccount,
  context: MatchWatcherProcessingContext,
  pending: PendingResult,
  currentState: WatcherState = currentStateFromWatcher(watcher),
) {
  if (pending.startedAt && isResultFetchTimedOut(pending.startedAt)) {
    botLogger.warn("match_tracking.fetch_result_timeout", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      matchId: pending.matchId,
    });
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      pending.messageId,
      buildResultFetchTimeoutEmbed(watcher, pending.matchId),
    );
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: null,
      pendingResultNotificationMessageId: null,
      pendingResultStartedAt: null,
      currentMatchId: null,
      lastCheckedAt: new Date(),
    });
    return { status: "cleared" as const, messageId };
  }

  const match = await getMatchForPendingResult(
    context,
    account,
    pending.matchId,
  );
  if (!match) {
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: pending.matchId,
      pendingResultNotificationMessageId: pending.messageId,
      pendingResultStartedAt: pending.startedAt,
      currentMatchId: null,
      lastCheckedAt: new Date(),
    });
    return { status: "pending" as const, messageId: pending.messageId };
  }

  const messageId = await sendOrEditWatcherMessage(
    client,
    watcher,
    pending.messageId,
    await buildMatchResultEmbed(watcher, account, match),
  );
  await setWatcherState(watcher, {
    ...currentState,
    currentMatchId: null,
    pendingResultMatchId: null,
    pendingResultNotificationMessageId: null,
    pendingResultStartedAt: null,
    lastCheckedAt: new Date(),
  });
  return { status: "cleared" as const, messageId };
}

async function processWatcher(
  client: Client,
  watcher: MatchWatcher,
  context: MatchWatcherProcessingContext,
) {
  const accountResult = await getRiotAccountForWatcher(
    context,
    watcher.targetDiscordId,
  );
  if (!accountResult.success) {
    botLogger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: accountResult.error,
    });
    return;
  }
  const account = accountResult.account;

  const pending = pendingResultFromWatcher(watcher);
  let pendingStatus: "none" | "pending" | "cleared" = "none";
  if (pending) {
    const result = await tryFetchAndNotifyResult(
      client,
      watcher,
      account,
      context,
      pending,
    );
    pendingStatus = result.status;
    if (watcher.lastState === "FETCHING_RESULT" && watcher.currentMatchId) {
      return;
    }
  }

  const activeGame = await getActiveGameForAccount(context, account);
  if (!activeGame) {
    if (watcher.lastState === "IN_GAME" && watcher.currentGameId) {
      const matchId = matchIdForGame(account, watcher.currentGameId);
      const messageId = await sendOrEditWatcherMessage(
        client,
        watcher,
        watcher.currentNotificationMessageId,
        buildResultPendingEmbed(watcher, matchId),
      );
      await tryFetchAndNotifyResult(client, watcher, account, context, {
        matchId,
        messageId,
        startedAt: watcher.gameStartedAt,
      }, {
        lastState: "IDLE",
        currentGameId: null,
        currentMatchId: null,
        currentNotificationMessageId: null,
        gameStartedAt: null,
        lastInGameNotifiedAt: null,
      });
      return;
    }

    if (watcher.lastState === "IDLE" && watcher.currentGameId === null) {
      return;
    }

    await setWatcherState(watcher, {
      lastState: "IDLE",
      currentGameId: null,
      currentNotificationMessageId: null,
      lastCheckedAt: new Date(),
    });
    return;
  }

  const currentGameId = String(activeGame.gameId);
  if (
    watcher.lastState === "IN_GAME" &&
    watcher.currentGameId &&
    watcher.currentGameId !== currentGameId
  ) {
    if (pendingStatus === "pending") {
      botLogger.warn("match_tracking.pending_result_replaced", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
        pendingMatchId: pending?.matchId,
      });
    }
    const previousMatchId = matchIdForGame(account, watcher.currentGameId);
    const previousMessageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      watcher.currentNotificationMessageId,
      buildResultPendingEmbed(watcher, previousMatchId),
    );
    const newMessageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      null,
      await buildActiveGameEmbed(watcher, account, activeGame, "started"),
    );
    const currentState = {
      lastState: "IN_GAME" as const,
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: newMessageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastInGameNotifiedAt: new Date(),
    };
    await setWatcherState(watcher, {
      ...currentState,
      pendingResultMatchId: previousMatchId,
      pendingResultNotificationMessageId: previousMessageId,
      pendingResultStartedAt: watcher.gameStartedAt,
      lastCheckedAt: new Date(),
    });
    await tryFetchAndNotifyResult(client, watcher, account, context, {
      matchId: previousMatchId,
      messageId: previousMessageId,
      startedAt: watcher.gameStartedAt,
    }, currentState);
    return;
  }

  const started = watcher.lastState !== "IN_GAME" ||
    watcher.currentGameId !== currentGameId;
  if (started) {
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      null,
      await buildActiveGameEmbed(watcher, account, activeGame, "started"),
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentMatchId: null,
      currentNotificationMessageId: messageId,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastCheckedAt: new Date(),
      lastInGameNotifiedAt: new Date(),
    });
    return;
  }

  if (shouldNotifyInGame(watcher)) {
    const messageId = await sendOrEditWatcherMessage(
      client,
      watcher,
      watcher.currentNotificationMessageId,
      await buildActiveGameEmbed(watcher, account, activeGame, "progress"),
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentNotificationMessageId: messageId,
      lastCheckedAt: new Date(),
      lastInGameNotifiedAt: new Date(),
    });
    return;
  }

  await setWatcherState(watcher, {
    lastState: "IN_GAME",
    currentGameId,
    lastCheckedAt: new Date(),
  });
}

async function processMatchWatchers(client: Client) {
  const result = await apiClient.getEnabledMatchWatchers();
  if (!result.success) {
    botLogger.error("match_tracking.watchers_fetch_failed", {
      error: result.error,
    });
    return;
  }

  warnIfRiotRequestBudgetRisk(result.watchers.length);

  const context = createMatchWatcherProcessingContext();
  for (const watcher of result.watchers) {
    try {
      await processWatcher(client, watcher, context);
    } catch (error) {
      botLogger.error("match_tracking.watcher_failed", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      }, error);
    }
  }
}

let workerId: number | undefined;
let processingMatchWatchers = false;
let lastBudgetWarningAt = 0;

function warnIfRiotRequestBudgetRisk(
  watcherCount: number,
  pollIntervalMs = numberEnv(
    "MATCH_WATCH_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  ),
) {
  const longWindowLimit = numberEnv(
    "RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT",
    DEFAULT_RIOT_LONG_WINDOW_LIMIT,
  );
  const estimatedRequests = watcherCount *
    Math.ceil(RIOT_LONG_WINDOW_MS / pollIntervalMs);
  const now = Date.now();
  if (
    estimatedRequests >= longWindowLimit * 0.8 &&
    now - lastBudgetWarningAt >= RIOT_LONG_WINDOW_MS
  ) {
    lastBudgetWarningAt = now;
    botLogger.warn("match_tracking.riot_request_budget_risk", {
      watcherCount,
      pollIntervalMs,
      estimatedRequestsPer10Minutes: estimatedRequests,
      limitPer10Minutes: longWindowLimit,
    });
  }
}

async function guardedProcessMatchWatchers(client: Client) {
  if (processingMatchWatchers) {
    botLogger.warn("match_tracking.worker_tick_skipped", {
      reason: "previous_tick_still_running",
    });
    return;
  }
  processingMatchWatchers = true;
  try {
    await processMatchWatchers(client);
  } finally {
    processingMatchWatchers = false;
  }
}

function startMatchTrackingWorker(client: Client) {
  if (workerId !== undefined) return;

  const pollIntervalMs = numberEnv(
    "MATCH_WATCH_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  workerId = setInterval(() => {
    guardedProcessMatchWatchers(client);
  }, pollIntervalMs);
  guardedProcessMatchWatchers(client);
}

function stopMatchTrackingWorker() {
  if (workerId === undefined) return;
  clearInterval(workerId);
  workerId = undefined;
}

function getActiveParticipants(): Promise<
  { user: { id: string; username: string }; lane: Lane; team: "BLUE" | "RED" }[]
> {
  return Promise.resolve([
    { user: { id: "user1", username: "Player1" }, lane: "Top", team: "BLUE" },
    {
      user: { id: "user2", username: "Player2" },
      lane: "Jungle",
      team: "BLUE",
    },
    {
      user: { id: "user3", username: "Player3" },
      lane: "Middle",
      team: "BLUE",
    },
    {
      user: { id: "user4", username: "Player4" },
      lane: "Bottom",
      team: "BLUE",
    },
    {
      user: { id: "user5", username: "Player5" },
      lane: "Support",
      team: "BLUE",
    },
    { user: { id: "user6", username: "Player6" }, lane: "Top", team: "RED" },
    { user: { id: "user7", username: "Player7" }, lane: "Jungle", team: "RED" },
    { user: { id: "user8", username: "Player8" }, lane: "Middle", team: "RED" },
    { user: { id: "user9", username: "Player9" }, lane: "Bottom", team: "RED" },
    {
      user: { id: "user10", username: "Player10" },
      lane: "Support",
      team: "RED",
    },
  ]);
}

export const matchTracker = {
  getActiveParticipants,
  processMatchWatchers,
  startMatchTrackingWorker,
  stopMatchTrackingWorker,
  hasResultFetchTimedOut,
  shouldNotifyInGame,
  warnIfRiotRequestBudgetRisk,
};
