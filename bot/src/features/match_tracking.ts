import type { Client } from "discord.js";
import type { Lane, MatchWatcher, RiotAccount } from "@adteemo/api/schema";
import { riotApi } from "@adteemo/api/riot-api";
import { apiClient } from "../api_client.ts";
import { botLogger } from "../logger.ts";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_IN_GAME_NOTIFY_INTERVAL_MS = 300_000;

type ActiveGame = NonNullable<
  Awaited<ReturnType<typeof riotApi.getActiveGameByPuuid>>
>;
type RiotMatch = NonNullable<Awaited<ReturnType<typeof riotApi.getMatchById>>>;

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function matchIdForGame(account: RiotAccount, gameId: string | number) {
  return `${account.platform.toUpperCase()}_${gameId}`;
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

function formatActiveGameMessage(
  watcher: MatchWatcher,
  account: RiotAccount,
  activeGame: ActiveGame,
  kind: "started" | "progress",
) {
  const participant = activeGame.participants.find((p) =>
    p.puuid === account.puuid
  );
  const title = kind === "started" ? "試合開始を検知しました" : "試合中です";
  const queue = activeGame.gameQueueConfigId ?? "不明";
  const champion = participant?.championId ?? "不明";
  const minutes = elapsedMinutes(activeGame);

  return [
    `### ${title}`,
    `<@${watcher.targetDiscordId}> が試合中です。`,
    `Riot ID: ${account.gameName}#${account.tagLine}`,
    `Game ID: ${activeGame.gameId}`,
    `Mode: ${activeGame.gameMode} / Queue: ${queue} / Map: ${activeGame.mapId}`,
    `Champion ID: ${champion}`,
    `経過時間: 約${minutes}分`,
  ].join("\n");
}

function formatFinishDetectedMessage(watcher: MatchWatcher, matchId: string) {
  return [
    "### 試合終了を検知しました",
    `<@${watcher.targetDiscordId}> の試合が終了しました。`,
    `Match ID: ${matchId}`,
    "戦績が反映され次第、結果を通知します。",
  ].join("\n");
}

function formatMatchResultMessage(
  watcher: MatchWatcher,
  account: RiotAccount,
  match: RiotMatch,
) {
  const participant = match.info.participants.find((p) =>
    p.puuid === account.puuid
  );
  if (!participant) {
    return [
      "### 試合結果を取得しました",
      `<@${watcher.targetDiscordId}> の参加者データが見つかりませんでした。`,
      `Match ID: ${match.metadata.matchId}`,
    ].join("\n");
  }

  const cs = participant.totalMinionsKilled + participant.neutralMinionsKilled;
  const result = participant.win ? "勝利" : "敗北";
  return [
    "### 試合結果",
    `<@${watcher.targetDiscordId}>: ${result}`,
    `Match ID: ${match.metadata.matchId}`,
    `Champion: ${participant.championName}`,
    `KDA: ${participant.kills}/${participant.deaths}/${participant.assists}`,
    `CS: ${cs}`,
    `Gold: ${participant.goldEarned}`,
  ].join("\n");
}

async function sendToWatcherChannel(
  client: Client,
  watcher: MatchWatcher,
  content: string,
) {
  const channel = await client.channels.fetch(watcher.channelId);
  if (!channel || !("send" in channel)) {
    botLogger.warn("match_tracking.channel_not_found", {
      guildId: watcher.guildId,
      channelId: watcher.channelId,
    });
    return;
  }
  await channel.send(content);
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
  matchId: string,
) {
  const match = await riotApi.getMatchById(account.region, matchId);
  if (!match) {
    await setWatcherState(watcher, {
      lastState: "FETCHING_RESULT",
      currentMatchId: matchId,
      lastCheckedAt: new Date(),
    });
    return;
  }

  await sendToWatcherChannel(
    client,
    watcher,
    formatMatchResultMessage(watcher, account, match),
  );
  await setWatcherState(watcher, {
    lastState: "IDLE",
    currentGameId: null,
    currentMatchId: null,
    gameStartedAt: null,
    lastCheckedAt: new Date(),
    lastInGameNotifiedAt: null,
  });
}

async function processWatcher(client: Client, watcher: MatchWatcher) {
  const accountResult = await apiClient.getRiotAccount(watcher.targetDiscordId);
  if (!accountResult.success) {
    botLogger.warn("match_tracking.riot_account_not_found", {
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      error: accountResult.error,
    });
    return;
  }
  const account = accountResult.account;

  if (watcher.lastState === "FETCHING_RESULT" && watcher.currentMatchId) {
    await tryFetchAndNotifyResult(
      client,
      watcher,
      account,
      watcher.currentMatchId,
    );
    return;
  }

  const activeGame = await riotApi.getActiveGameByPuuid(
    account.platform,
    account.puuid,
  );
  if (!activeGame) {
    if (watcher.lastState === "IN_GAME" && watcher.currentGameId) {
      const matchId = matchIdForGame(account, watcher.currentGameId);
      await sendToWatcherChannel(
        client,
        watcher,
        formatFinishDetectedMessage(watcher, matchId),
      );
      await tryFetchAndNotifyResult(client, watcher, account, matchId);
      return;
    }

    await setWatcherState(watcher, {
      lastState: "IDLE",
      currentGameId: null,
      lastCheckedAt: new Date(),
    });
    return;
  }

  const currentGameId = String(activeGame.gameId);
  const started = watcher.lastState !== "IN_GAME" ||
    watcher.currentGameId !== currentGameId;
  if (started) {
    await sendToWatcherChannel(
      client,
      watcher,
      formatActiveGameMessage(watcher, account, activeGame, "started"),
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
      currentMatchId: null,
      gameStartedAt: new Date(activeGame.gameStartTime),
      lastCheckedAt: new Date(),
      lastInGameNotifiedAt: new Date(),
    });
    return;
  }

  if (shouldNotifyInGame(watcher)) {
    await sendToWatcherChannel(
      client,
      watcher,
      formatActiveGameMessage(watcher, account, activeGame, "progress"),
    );
    await setWatcherState(watcher, {
      lastState: "IN_GAME",
      currentGameId,
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

  for (const watcher of result.watchers) {
    try {
      await processWatcher(client, watcher);
    } catch (error) {
      botLogger.error("match_tracking.watcher_failed", {
        guildId: watcher.guildId,
        targetDiscordId: watcher.targetDiscordId,
      }, error);
    }
  }
}

let workerId: number | undefined;

function startMatchTrackingWorker(client: Client) {
  if (workerId !== undefined) return;

  const pollIntervalMs = numberEnv(
    "MATCH_WATCH_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  workerId = setInterval(() => {
    processMatchWatchers(client);
  }, pollIntervalMs);
  processMatchWatchers(client);
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
  shouldNotifyInGame,
};
