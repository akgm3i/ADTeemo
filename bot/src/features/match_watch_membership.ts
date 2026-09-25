import type { WatchPolicyApiClient } from "../api_clients/watch_policy.ts";

/** Full snapshots are serialized per guild, including the Discord read. */
export function createMatchWatchMembershipSync(
  api: Pick<WatchPolicyApiClient, "syncGuildMatchWatchMembers">,
  options: {
    scheduleRetry?: (callback: () => void) => () => void;
    onFailure?: (guildId: string, error: unknown) => void;
  } = {},
) {
  const scheduleRetry = options.scheduleRetry ?? ((callback) => {
    const timer = setTimeout(callback, 30_000);
    return () => clearTimeout(timer);
  });
  const retries = new Map<string, () => void>();
  const revisions = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();
  async function save(guildId: string, ids: string[]) {
    const result = await api.syncGuildMatchWatchMembers(guildId, ids);
    if (!result.success) throw new Error("Guild membership persistence failed");
    return result;
  }
  function sync(guildId: string, readMemberIds: () => Promise<string[]>) {
    const previous = pending.get(guildId) ?? Promise.resolve();
    const result = previous.then(async () => {
      let ids: string[];
      try {
        ids = await readMemberIds();
      } catch (error) {
        // Unknown membership must not keep departed users' saved watchers active.
        await save(guildId, []);
        throw error;
      }
      return await save(guildId, ids);
    });
    const settled = result.then(() => {}, () => {});
    pending.set(guildId, settled);
    void settled.then(() => {
      if (pending.get(guildId) === settled) pending.delete(guildId);
    });
    return result;
  }
  async function initialize(
    guilds: { id: string; readMemberIds: () => Promise<string[]> }[],
    start: () => void,
  ) {
    for (const guild of guilds) await sync(guild.id, guild.readMemberIds);
    start();
  }
  function cancelRefresh(guildId: string) {
    revisions.set(guildId, (revisions.get(guildId) ?? 0) + 1);
    retries.get(guildId)?.();
    retries.delete(guildId);
  }
  async function refresh(
    guildId: string,
    readMemberIds: () => Promise<string[]>,
  ) {
    const revision = revisions.get(guildId) ?? 0;
    try {
      await sync(guildId, readMemberIds);
      retries.get(guildId)?.();
      retries.delete(guildId);
    } catch (error) {
      options.onFailure?.(guildId, error);
      if (revision !== (revisions.get(guildId) ?? 0) || retries.has(guildId)) {
        return;
      }
      retries.set(
        guildId,
        scheduleRetry(() => {
          retries.delete(guildId);
          if (revision === (revisions.get(guildId) ?? 0)) {
            void refresh(guildId, readMemberIds);
          }
        }),
      );
    }
  }
  return { sync, initialize, refresh, cancelRefresh };
}
