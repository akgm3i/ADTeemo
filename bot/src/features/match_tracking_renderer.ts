import { EmbedBuilder } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import type { MessageKey, messageKeys } from "../messages.ts";
import type { OpggMatchDetail } from "../api_client.ts";
import {
  displayMetric,
  elapsedMinutes,
  formatKillParticipation,
  formatRankSnapshot,
  rankDelta,
  type RankSummary,
  type ResultMetricKind,
  resultMetricValues,
} from "./match_tracking_state.ts";

export type MatchTrackingStaticData = {
  champions: Record<string, { name: string | null; iconUrl?: string | null }>;
  queues: Record<string, string | null>;
  maps: Record<string, string | null>;
  gameModes: Record<string, string | null>;
};
export type MatchTrackingActiveGame = {
  gameId: string | number;
  gameStartTime: number;
  gameLength?: number;
  gameQueueConfigId?: number;
  mapId: number;
  gameMode: string;
  participants: Array<{
    puuid?: string;
    championId?: number;
  }>;
};
export type MatchTrackingRiotMatchParticipant = {
  puuid: string;
  championId?: number;
  championName?: string;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned: number;
  totalDamageDealtToChampions?: number;
  visionScore?: number;
  totalEnemyJungleMinionsKilled?: number;
  teamPosition?: string;
  individualPosition?: string;
};
export type MatchTrackingRiotMatch = {
  metadata: { matchId: string };
  info: {
    gameDuration: number;
    gameEndTimestamp?: number;
    gameMode: string;
    mapId: number;
    queueId: number;
    participants: MatchTrackingRiotMatchParticipant[];
  };
};
export type ActiveGameTargetDetail = {
  targetDiscordId: string;
  championId?: number;
};
export type MatchTrackingRendererDependencies = {
  messages: {
    formatMessage: (
      key: MessageKey,
      params?: Record<string, string | number>,
    ) => string;
    keys: typeof messageKeys;
  };
  resolveStaticData: (input: {
    championIds: number[];
    queueIds: number[];
    mapIds: number[];
    gameModes: string[];
  }) => Promise<MatchTrackingStaticData | null>;
  clock: {
    now: () => Date;
  };
};

export function createMatchTrackingRenderer(
  dependencies: MatchTrackingRendererDependencies,
) {
  const { messages } = dependencies;

  function fallbackChampionName(
    championId: number | undefined,
    fallbackName?: string,
  ) {
    if (fallbackName) return fallbackName;
    if (championId === undefined) {
      return messages.formatMessage(
        messages.keys.matchTracking.embed.fallback.unknownChampion,
      );
    }
    return messages.formatMessage(
      messages.keys.matchTracking.embed.fallback.championId,
      { id: championId },
    );
  }

  function championNameById(
    staticData: MatchTrackingStaticData | null,
    championId: number | undefined,
    fallbackName?: string,
  ) {
    if (championId === undefined) {
      return fallbackChampionName(championId, fallbackName);
    }
    return staticData?.champions[String(championId)]?.name ??
      fallbackChampionName(championId, fallbackName);
  }

  function championIconUrlById(
    staticData: MatchTrackingStaticData | null,
    championId: number | undefined,
  ) {
    if (championId === undefined) return null;
    return staticData?.champions[String(championId)]?.iconUrl ?? null;
  }

  function queueName(
    staticData: MatchTrackingStaticData | null,
    queueId: number | undefined,
  ) {
    if (queueId === undefined) {
      return messages.formatMessage(
        messages.keys.matchTracking.embed.fallback.unknownQueue,
      );
    }
    const fallback = messages.formatMessage(
      messages.keys.matchTracking.embed.fallback.queueId,
      { id: queueId },
    );
    return staticData?.queues[String(queueId)] ?? fallback;
  }

  function mapName(
    staticData: MatchTrackingStaticData | null,
    mapId: number,
  ) {
    const fallback = messages.formatMessage(
      messages.keys.matchTracking.embed.fallback.mapId,
      { id: mapId },
    );
    return staticData?.maps[String(mapId)] ?? fallback;
  }

  function gameModeName(
    staticData: MatchTrackingStaticData | null,
    gameMode: string,
  ) {
    return staticData?.gameModes[gameMode] ?? gameMode;
  }

  function resultMetricFieldMessageKey(kind: ResultMetricKind) {
    switch (kind) {
      case "visionScore":
        return messages.keys.matchTracking.embed.field.visionScore;
      case "visionScorePerMinute":
        return messages.keys.matchTracking.embed.field.visionScorePerMinute;
      case "jungleCs":
        return messages.keys.matchTracking.embed.field.jungleCs;
      case "enemyJungleCs":
        return messages.keys.matchTracking.embed.field.enemyJungleCs;
      case "cs":
        return messages.keys.matchTracking.embed.field.cs;
      case "csPerMinute":
        return messages.keys.matchTracking.embed.field.csPerMinute;
    }
  }

  function resultMetricFields(
    participant: MatchTrackingRiotMatchParticipant,
    gameDurationSeconds: number,
  ) {
    return resultMetricValues(participant, gameDurationSeconds).map(
      ({ kind, value }) => ({
        name: messages.formatMessage(resultMetricFieldMessageKey(kind)),
        value,
        inline: true,
      }),
    );
  }

  function rankFieldValue(summary: RankSummary | null) {
    if (!summary?.after) return null;

    const afterRank = formatRankSnapshot(summary.after);
    if (!afterRank) return null;

    if (!summary.before) {
      return messages.formatMessage(
        messages.keys.matchTracking.embed.rank.current,
        { rank: afterRank },
      );
    }

    const beforeRank = formatRankSnapshot(summary.before);
    const delta = beforeRank ? rankDelta(summary.before, summary.after) : null;
    if (beforeRank && delta !== null) {
      const sign = delta > 0 ? "+" : "";
      return messages.formatMessage(
        messages.keys.matchTracking.embed.rank.delta,
        {
          delta: `${sign}${delta}`,
          before: beforeRank,
          after: afterRank,
        },
      );
    }

    return messages.formatMessage(
      messages.keys.matchTracking.embed.rank.current,
      { rank: afterRank },
    );
  }

  function opggScoreValue(score: number) {
    return score.toFixed(1);
  }

  function opggFieldValue(detail: OpggMatchDetail | null) {
    if (!detail) return null;

    const lines = [
      messages.formatMessage(
        messages.keys.matchTracking.embed.opgg.detail,
        { url: detail.detailUrl },
      ),
    ];
    const laneScore = detail.participant?.laneScore;
    if (laneScore !== null && laneScore !== undefined) {
      lines.push(
        messages.formatMessage(
          messages.keys.matchTracking.embed.opgg.laneScore,
          { score: opggScoreValue(laneScore) },
        ),
      );
    }
    if (detail.averageTier) {
      lines.push(
        messages.formatMessage(
          messages.keys.matchTracking.embed.opgg.averageTier,
          { tier: detail.averageTier },
        ),
      );
    }
    return lines.join("\n");
  }

  async function activeGame(
    watcher: MatchWatcher,
    account: RiotAccount,
    activeGame: MatchTrackingActiveGame,
    kind: "started" | "progress",
    targetDetails?: ActiveGameTargetDetail[],
  ) {
    const participant = activeGame.participants.find((p) =>
      p.puuid === account.puuid
    );
    const now = dependencies.clock.now();
    const minutes = elapsedMinutes(activeGame, now.getTime());
    const championIds = [
      participant?.championId,
      ...(targetDetails?.map((detail) => detail.championId) ?? []),
    ].filter((id): id is number => id !== undefined);
    const staticData = await dependencies.resolveStaticData({
      championIds: [...new Set(championIds)],
      queueIds: activeGame.gameQueueConfigId === undefined
        ? []
        : [activeGame.gameQueueConfigId],
      mapIds: [activeGame.mapId],
      gameModes: [activeGame.gameMode],
    });
    const champion = championNameById(
      staticData,
      participant?.championId,
    );
    const queue = queueName(staticData, activeGame.gameQueueConfigId);
    const map = mapName(staticData, activeGame.mapId);
    const mode = gameModeName(staticData, activeGame.gameMode);
    const title = kind === "started"
      ? messages.formatMessage(
        messages.keys.matchTracking.embed.active.startedTitle,
      )
      : messages.formatMessage(
        messages.keys.matchTracking.embed.active.progressTitle,
      );
    const targets = targetDetails?.length
      ? targetDetails.map(({ targetDiscordId, championId }) => ({
        targetDiscordId,
        champion: championNameById(staticData, championId),
      }))
      : [{ targetDiscordId: watcher.targetDiscordId, champion }];
    const thumbnailUrl = targets.length === 1
      ? championIconUrlById(staticData, participant?.championId)
      : null;
    const description = messages.formatMessage(
      messages.keys.matchTracking.embed.active.description,
      {
        member: targets.map(({ targetDiscordId }) => `<@${targetDiscordId}>`)
          .join(", "),
      },
    );
    const targetChampionField = targets.length > 1
      ? {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.activeChampions,
        ),
        value: targets.map(({ targetDiscordId, champion }) =>
          `<@${targetDiscordId}>: ${champion}`
        ).join("\n"),
        inline: false,
      }
      : {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.champion,
        ),
        value: champion,
        inline: true,
      };
    const footerText = targets.length > 1
      ? messages.formatMessage(
        messages.keys.matchTracking.embed.footer.gameOnly,
        {
          platform: account.platform.toUpperCase(),
          gameId: activeGame.gameId,
        },
      )
      : messages.formatMessage(
        messages.keys.matchTracking.embed.footer.game,
        {
          platform: account.platform.toUpperCase(),
          gameId: activeGame.gameId,
          riotId: `${account.gameName}#${account.tagLine}`,
        },
      );

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(kind === "started" ? 0x2ecc71 : 0x3498db)
      .addFields(
        targetChampionField,
        {
          name: messages.formatMessage(
            messages.keys.matchTracking.embed.field.queue,
          ),
          value: queue,
          inline: true,
        },
        {
          name: messages.formatMessage(
            messages.keys.matchTracking.embed.field.map,
          ),
          value: map,
          inline: true,
        },
        {
          name: messages.formatMessage(
            messages.keys.matchTracking.embed.field.mode,
          ),
          value: mode,
          inline: true,
        },
        {
          name: messages.formatMessage(
            messages.keys.matchTracking.embed.field.elapsed,
          ),
          value: messages.formatMessage(
            messages.keys.matchTracking.embed.fallback.elapsedMinutes,
            { minutes },
          ),
          inline: true,
        },
      )
      .setFooter({
        text: footerText,
      })
      .setTimestamp(now);
    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }
    return embed;
  }

  function resultPending(watcher: MatchWatcher, matchId: string) {
    return new EmbedBuilder()
      .setTitle(
        messages.formatMessage(
          messages.keys.matchTracking.embed.resultPending.title,
        ),
      )
      .setDescription(
        messages.formatMessage(
          messages.keys.matchTracking.embed.resultPending.description,
          { member: `<@${watcher.targetDiscordId}>` },
        ),
      )
      .setColor(0xf1c40f)
      .setFooter({
        text: messages.formatMessage(
          messages.keys.matchTracking.embed.footer.match,
          { matchId },
        ),
      })
      .setTimestamp(dependencies.clock.now());
  }

  function resultFetchTimeout(
    watcher: MatchWatcher,
    matchId: string,
  ) {
    return new EmbedBuilder()
      .setTitle(
        messages.formatMessage(
          messages.keys.matchTracking.embed.resultTimeout.title,
        ),
      )
      .setDescription(
        messages.formatMessage(
          messages.keys.matchTracking.embed.resultTimeout.description,
          { member: `<@${watcher.targetDiscordId}>` },
        ),
      )
      .setColor(0x95a5a6)
      .setFooter({
        text: messages.formatMessage(
          messages.keys.matchTracking.embed.footer.match,
          { matchId },
        ),
      })
      .setTimestamp(dependencies.clock.now());
  }

  async function matchResult(
    watcher: MatchWatcher,
    account: RiotAccount,
    match: MatchTrackingRiotMatch,
    rankSummary: RankSummary | null = null,
    opggDetail: OpggMatchDetail | null = null,
  ) {
    const participant = match.info.participants.find((p) =>
      p.puuid === account.puuid
    );
    if (!participant) {
      return new EmbedBuilder()
        .setTitle(
          messages.formatMessage(
            messages.keys.matchTracking.embed.result.participantMissingTitle,
          ),
        )
        .setDescription(
          messages.formatMessage(
            messages.keys.matchTracking.embed.result
              .participantMissingDescription,
            { member: `<@${watcher.targetDiscordId}>` },
          ),
        )
        .setColor(0x95a5a6)
        .setFooter({
          text: messages.formatMessage(
            messages.keys.matchTracking.embed.footer.match,
            { matchId: match.metadata.matchId },
          ),
        })
        .setTimestamp(dependencies.clock.now());
    }

    const staticData = await dependencies.resolveStaticData({
      championIds: participant.championId === undefined
        ? []
        : [participant.championId],
      queueIds: [match.info.queueId],
      mapIds: [match.info.mapId],
      gameModes: [match.info.gameMode],
    });
    const champion = championNameById(
      staticData,
      participant.championId,
      participant.championName,
    );
    const thumbnailUrl = championIconUrlById(
      staticData,
      participant.championId,
    );
    const teamKills = match.info.participants
      .filter((candidate) => candidate.teamId === participant.teamId)
      .reduce((sum, candidate) => sum + candidate.kills, 0);
    const killParticipation = formatKillParticipation(
      participant.kills,
      participant.assists,
      teamKills,
    );
    const queue = queueName(staticData, match.info.queueId);
    const map = mapName(staticData, match.info.mapId);
    const mode = gameModeName(staticData, match.info.gameMode);
    const result = participant.win
      ? messages.formatMessage(messages.keys.matchTracking.embed.result.win)
      : messages.formatMessage(messages.keys.matchTracking.embed.result.loss);
    const rankValue = rankFieldValue(rankSummary);
    const opggValue = opggFieldValue(opggDetail);
    const fields: { name: string; value: string; inline: boolean }[] = [
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.champion,
        ),
        value: champion,
        inline: true,
      },
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.kda,
        ),
        value:
          `${participant.kills}/${participant.deaths}/${participant.assists}`,
        inline: true,
      },
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.killParticipation,
        ),
        value: killParticipation,
        inline: true,
      },
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.gold,
        ),
        value: String(participant.goldEarned),
        inline: true,
      },
    ];
    const damage = displayMetric(participant.totalDamageDealtToChampions);
    if (damage) {
      fields.push({
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.damage,
        ),
        value: damage,
        inline: true,
      });
    }
    fields.push(
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.queue,
        ),
        value: queue,
        inline: true,
      },
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.map,
        ),
        value: map,
        inline: true,
      },
      {
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.mode,
        ),
        value: mode,
        inline: true,
      },
      ...resultMetricFields(participant, match.info.gameDuration),
    );
    const embed = new EmbedBuilder()
      .setTitle(
        messages.formatMessage(
          messages.keys.matchTracking.embed.result.title,
          { result },
        ),
      )
      .setDescription(
        messages.formatMessage(
          messages.keys.matchTracking.embed.result.description,
          { member: `<@${watcher.targetDiscordId}>` },
        ),
      )
      .setColor(participant.win ? 0x2ecc71 : 0xe74c3c)
      .addFields(fields)
      .setFooter({
        text: messages.formatMessage(
          messages.keys.matchTracking.embed.footer.matchWithRiotId,
          {
            matchId: match.metadata.matchId,
            riotId: `${account.gameName}#${account.tagLine}`,
          },
        ),
      })
      .setTimestamp(
        new Date(match.info.gameEndTimestamp ?? dependencies.clock.now()),
      );
    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }
    if (rankValue) {
      embed.addFields({
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.rank,
        ),
        value: rankValue,
        inline: false,
      });
    }
    if (opggValue) {
      embed.addFields({
        name: messages.formatMessage(
          messages.keys.matchTracking.embed.field.opgg,
        ),
        value: opggValue,
        inline: false,
      });
    }
    return embed;
  }

  return {
    activeGame,
    resultPending,
    resultFetchTimeout,
    matchResult,
  };
}
