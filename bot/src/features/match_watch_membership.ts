import type { WatchPolicyApiClient } from "../api_clients/watch_policy.ts";

const FULL_MEMBER_REQUEST_INTERVAL_MS = 30_000;

type MemberReader = () => Promise<string[]>;
type GuildSnapshot = {
  id: string;
  generation: number;
  readMemberIds?: MemberReader;
  members: Set<string> | null;
  changes: Map<string, boolean>;
  revision: number;
  savedRevision: number;
  nextReadAt: number;
  read?: {
    generation: number;
    promise: Promise<void>;
    cancelWait?: () => void;
  };
  save?: Promise<void>;
  cancelRetry?: () => void;
};

/** Only a completed full read establishes membership; Gateway events update it. */
export function createMatchWatchMembershipSync(
  api: Pick<WatchPolicyApiClient, "syncGuildMatchWatchMembers">,
  options: {
    now?: () => number;
    schedule?: (callback: () => void, delayMs: number) => () => void;
    onFailure?: (guildId: string, error: unknown) => void;
  } = {},
) {
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  });
  const guilds = new Map<string, GuildSnapshot>();
  let started = false;

  function stateFor(id: string) {
    let state = guilds.get(id);
    if (!state) {
      state = {
        id,
        generation: 0,
        members: null,
        changes: new Map(),
        revision: 0,
        savedRevision: 0,
        nextReadAt: 0,
      };
      guilds.set(id, state);
    }
    return state;
  }

  function cancelRetry(state: GuildSnapshot) {
    state.cancelRetry?.();
    state.cancelRetry = undefined;
  }

  function retry(state: GuildSnapshot) {
    if (state.cancelRetry) return;
    const generation = state.generation;
    const cancel = schedule(() => {
      if (state.cancelRetry !== cancel || generation !== state.generation) {
        return;
      }
      state.cancelRetry = undefined;
      void recover(state);
    }, FULL_MEMBER_REQUEST_INTERVAL_MS);
    state.cancelRetry = cancel;
  }

  // Reads never hold the write queue. A guild leaving during a pending Discord
  // request can therefore clear its saved membership immediately.
  function save(state: GuildSnapshot): Promise<void> {
    if (state.save) return state.save;
    const task = (async () => {
      while (state.savedRevision !== state.revision) {
        const revision = state.revision;
        const result = await api.syncGuildMatchWatchMembers(
          state.id,
          [...(state.members ?? [])],
        );
        if (!result.success) {
          throw new Error("Guild membership persistence failed");
        }
        state.savedRevision = revision;
      }
    })();
    state.save = task;
    void task.finally(() => {
      if (state.save === task) state.save = undefined;
    }).catch(() => {});
    return task;
  }

  function read(state: GuildSnapshot): Promise<void> {
    if (state.read?.generation === state.generation) return state.read.promise;
    const readMemberIds = state.readMemberIds;
    if (!readMemberIds) return save(state);
    const pending = {
      generation: state.generation,
      promise: Promise.resolve(),
      cancelWait: undefined as (() => void) | undefined,
    };
    state.read = pending;
    const current = () => pending.generation === state.generation;
    pending.promise = (async () => {
      await save(state);
      // RATE_LIMITED can extend this deadline while an earlier wait is pending.
      while (current() && now() < state.nextReadAt) {
        await new Promise<void>((resolve) => {
          const cancel = schedule(resolve, state.nextReadAt - now());
          pending.cancelWait = () => {
            cancel();
            resolve();
          };
        });
        pending.cancelWait = undefined;
      }
      if (!current()) return;
      state.nextReadAt = now() + FULL_MEMBER_REQUEST_INTERVAL_MS;
      let ids: string[];
      try {
        ids = await readMemberIds();
      } catch (error) {
        if (!current()) return;
        state.members = null;
        state.revision++;
        state.nextReadAt = Math.max(
          state.nextReadAt,
          now() + FULL_MEMBER_REQUEST_INTERVAL_MS,
        );
        // Unknown membership must stop saved watchers, including departed users.
        await save(state);
        throw error;
      }
      if (!current()) return;
      state.members = new Set(ids);
      for (const [id, present] of state.changes) {
        if (present) state.members.add(id);
        else state.members.delete(id);
      }
      state.changes.clear();
      state.revision++;
      await save(state);
    })().finally(() => {
      if (state.read === pending) state.read = undefined;
    });
    return pending.promise;
  }

  async function reconcile(state: GuildSnapshot) {
    const generation = state.generation;
    try {
      await (state.members === null ? read(state) : save(state));
      if (
        generation === state.generation &&
        state.savedRevision === state.revision &&
        (state.members !== null || !state.readMemberIds)
      ) cancelRetry(state);
    } catch (error) {
      if (generation !== state.generation) return;
      options.onFailure?.(state.id, error);
      retry(state);
      throw error;
    }
  }

  async function recover(state: GuildSnapshot) {
    // Event handlers report failures and schedule retries through reconcile.
    // Startup uses reconcile directly so a failed save cannot start the worker.
    try {
      await reconcile(state);
    } catch { /* Failure is reported and retried by reconcile. */ }
  }

  function invalidate(state: GuildSnapshot) {
    state.generation++;
    cancelRetry(state);
    state.read?.cancelWait?.();
    state.members = null;
    state.changes.clear();
    state.revision++;
  }

  function refresh(guildId: string, readMemberIds: MemberReader) {
    const state = stateFor(guildId);
    if (state.read?.generation !== state.generation) {
      if (state.readMemberIds || state.members !== null) invalidate(state);
      state.readMemberIds = readMemberIds;
    }
    return recover(state);
  }

  function change(guildId: string, memberId: string, present: boolean) {
    const state = stateFor(guildId);
    if (state.members === null) {
      state.changes.set(memberId, present);
      return Promise.resolve();
    }
    // Late events for a departed guild must not resurrect its empty snapshot.
    if (!state.readMemberIds || state.members.has(memberId) === present) {
      return Promise.resolve();
    }
    if (present) state.members.add(memberId);
    else state.members.delete(memberId);
    state.revision++;
    return recover(state);
  }

  function removeGuild(guildId: string) {
    const state = stateFor(guildId);
    invalidate(state);
    state.readMemberIds = undefined;
    state.members = new Set();
    return recover(state);
  }

  function suspendGuild(guildId: string) {
    const state = stateFor(guildId);
    invalidate(state);
    state.readMemberIds = undefined;
    return recover(state);
  }

  async function initialize(
    snapshots: { id: string; readMemberIds: MemberReader }[],
    start: () => void,
  ) {
    for (const snapshot of snapshots) {
      const state = stateFor(snapshot.id);
      if (!state.readMemberIds) {
        state.members = null;
        state.readMemberIds = snapshot.readMemberIds;
      }
    }
    // A guild can join/recover, or a member can leave, during any awaited read
    // or save. Check all current generations again before opening the worker.
    while (!started) {
      await Promise.all([...guilds.values()].map(reconcile));
      if (
        [...guilds.values()].some((state) =>
          state.members === null || state.savedRevision !== state.revision
        )
      ) {
        if (
          [...guilds.values()].some((state) =>
            state.members === null && !state.readMemberIds
          )
        ) throw new Error("Guild membership is unavailable");
        continue;
      }
      started = true;
      start();
    }
  }

  function rateLimited(guildId: string, retryAfterSeconds: number) {
    const state = stateFor(guildId);
    state.nextReadAt = Math.max(
      state.nextReadAt,
      now() + Math.ceil(retryAfterSeconds * 1000),
    );
  }

  return {
    initialize,
    refresh,
    addMember: (guildId: string, memberId: string) =>
      change(guildId, memberId, true),
    removeMember: (guildId: string, memberId: string) =>
      change(guildId, memberId, false),
    removeGuild,
    suspendGuild,
    rateLimited,
  };
}
