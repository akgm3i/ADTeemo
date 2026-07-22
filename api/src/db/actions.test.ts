import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createDbActionsConfigFromEnv } from "./actions.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

describe("createDbActionsConfigFromEnv", () => {
  test("DB action設定が未指定のとき、既定の監視上限とsnapshot TTLを返す", () => {
    // Arrange
    const environment = env({});

    // Act
    const config = createDbActionsConfigFromEnv(environment);

    // Assert
    assertEquals(config, {
      matchWatcherMaxEnabledPerGuild: 20,
      pendingRankSnapshotTtlMs: 6 * 60 * 60 * 1_000,
    });
  });

  test("正の数値を指定したとき、DB action設定へ反映する", () => {
    // Arrange
    const environment = env({
      MATCH_WATCH_MAX_ENABLED_PER_GUILD: "5",
      PENDING_RANK_SNAPSHOT_TTL_MS: "30000",
    });

    // Act
    const config = createDbActionsConfigFromEnv(environment);

    // Assert
    assertEquals(config, {
      matchWatcherMaxEnabledPerGuild: 5,
      pendingRankSnapshotTtlMs: 30_000,
    });
  });

  test("0以下または数値でない値を指定したとき、安全な既定値へ戻す", () => {
    // Arrange
    const environment = env({
      MATCH_WATCH_MAX_ENABLED_PER_GUILD: "0",
      PENDING_RANK_SNAPSHOT_TTL_MS: "invalid",
    });

    // Act
    const config = createDbActionsConfigFromEnv(environment);

    // Assert
    assertEquals(config, {
      matchWatcherMaxEnabledPerGuild: 20,
      pendingRankSnapshotTtlMs: 6 * 60 * 60 * 1_000,
    });
  });
});
