import type { LeagueEntry } from "./models.ts";
import type { RankSnapshotPayload } from "./schemas.ts";

const rankedQueues = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] as const;

export function rankedQueueTypeByQueueId(queueId: number | undefined) {
  return queueId === 420
    ? "RANKED_SOLO_5x5" as const
    : queueId === 440
    ? "RANKED_FLEX_SR" as const
    : undefined;
}

export function rankSnapshotPayloadsFromEntries(
  entries: LeagueEntry[],
  fetchedAt: Date,
): RankSnapshotPayload[] {
  return rankedQueues.map((queueType) => {
    const entry = entries.find((candidate) =>
      candidate.queueType === queueType
    );
    return {
      queueType,
      tier: entry?.tier ?? null,
      rank: entry?.rank ?? null,
      leaguePoints: entry?.leaguePoints ?? null,
      wins: entry?.wins ?? null,
      losses: entry?.losses ?? null,
      fetchedAt,
    };
  });
}
