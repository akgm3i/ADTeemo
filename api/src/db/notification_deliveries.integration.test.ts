import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { DomainConflictError } from "../errors.ts";
import { createDb } from "./index.ts";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";
import { createNotificationDeliveriesRepository } from "./repositories/notification_deliveries.ts";

const input = {
  key: "guild-1:user-1:JP1_123:result",
  guildId: "guild-1",
  targetDiscordId: "user-1",
  riotAccountPuuid: "puuid-1",
  channelId: "channel-1",
  messageId: null,
  matchId: "JP1_123",
  stage: 3,
  revision: 0,
  embed: { title: "試合結果", fields: [{ name: "勝敗", value: "勝利" }] },
};
const now = 1_800_000_000_000;

describe("通知outbox repository integration", () => {
  test("同じ通知intentを再準備すると、初回payloadを維持して別guild/channelへの流用を拒否する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    using _clock = stub(Date, "now", () => now);
    const repository = createNotificationDeliveriesRepository(database.db);

    // Act
    const first = await repository.prepareNotificationDelivery(input);
    const replay = await repository.prepareNotificationDelivery({
      ...input,
      matchId: "JP1_123",
      stage: 3,
      revision: 0,
      embed: { title: "再計算された結果" },
      messageId: "different-message",
    });

    // Assert
    assertEquals(replay, first);
    assertEquals(first.status, "pending");
    assertEquals(first.createdAt, now);
    await assertRejects(() =>
      repository.prepareNotificationDelivery({
        ...input,
        guildId: "other-guild",
      }), DomainConflictError);
    await assertRejects(() =>
      repository.prepareNotificationDelivery({
        ...input,
        channelId: "other-channel",
      }), DomainConflictError);
  });

  test("2 workerが同じintentを同時claimすると、1 workerだけleaseを取得し期限後は再起動したworkerが回収する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    let currentTime = now;
    using _clock = stub(Date, "now", () => currentTime);
    const firstWorker = createNotificationDeliveriesRepository(database.db);
    const restartedWorker = createNotificationDeliveriesRepository(database.db);
    await firstWorker.prepareNotificationDelivery(input);

    // Act
    const claims = await Promise.all([
      firstWorker.claimNotificationDelivery(input.key),
      restartedWorker.claimNotificationDelivery(input.key),
    ]);
    const firstLease = claims.find((value) => value !== null)!;

    // Assert
    assertEquals(claims.filter(Boolean).length, 1);
    assertEquals(firstLease.attempts, 1);
    assertEquals(await restartedWorker.getPendingNotificationDeliveries(), []);
    currentTime += 120_000;
    assertEquals(
      (await restartedWorker.getPendingNotificationDeliveries()).length,
      1,
    );
    const recovered = await restartedWorker.claimNotificationDelivery(
      input.key,
    );
    assertEquals(recovered?.attempts, 2);
    await assertRejects(
      () =>
        firstWorker.completeNotificationDelivery(input.key, {
          leaseId: firstLease.leaseId!,
          messageId: "stale-message",
        }),
      DomainConflictError,
    );
  });

  test("配送完了後に応答を失って同じleaseを再送すると、receiptを再利用して通知を再claimしない", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    using _clock = stub(Date, "now", () => now);
    const repository = createNotificationDeliveriesRepository(database.db);
    await repository.prepareNotificationDelivery(input);
    const claimed = await repository.claimNotificationDelivery(input.key);
    const receipt = { leaseId: claimed!.leaseId!, messageId: "message-1" };

    // Act
    const first = await repository.completeNotificationDelivery(
      input.key,
      receipt,
    );
    const replay = await repository.completeNotificationDelivery(
      input.key,
      receipt,
    );
    const restartedRepository = createNotificationDeliveriesRepository(
      database.db,
    );
    const prepared = await restartedRepository.prepareNotificationDelivery(
      input,
    );

    // Assert
    assertEquals(first.status, "delivered");
    assertEquals(replay, first);
    assertEquals(prepared.messageId, "message-1");
    assertEquals(
      await restartedRepository.claimNotificationDelivery(input.key),
      null,
    );
    assertEquals(
      await restartedRepository.getPendingNotificationDeliveries(),
      [],
    );
  });

  test("DB接続を閉じて再起動すると、保存済みpending intentを新しい接続からclaimできる", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    using _clock = stub(Date, "now", () => now);
    await database.actions.prepareNotificationDelivery(input);
    database.client.close();
    const restarted = createDb({ url: `file:${database.databasePath}` });
    try {
      // Act
      const repository = createNotificationDeliveriesRepository(restarted.db);
      const pending = await repository.getPendingNotificationDeliveries();
      const claimed = await repository.claimNotificationDelivery(input.key);

      // Assert
      assertEquals(pending.map((delivery) => delivery.key), [input.key]);
      assertEquals(claimed?.embed, input.embed);
      assertEquals(claimed?.attempts, 1);
    } finally {
      restarted.close();
    }
  });

  test("一時失敗時はbackoffまで再claimせず、failの再送で期限を延ばさず6回失敗後は停止する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    let currentTime = now;
    using _clock = stub(Date, "now", () => currentTime);
    const repository = createNotificationDeliveriesRepository(database.db);
    await repository.prepareNotificationDelivery(input);

    // Act & Assert
    for (let attempt = 1; attempt <= 6; attempt++) {
      const claimed = await repository.claimNotificationDelivery(input.key);
      assertEquals(claimed?.attempts, attempt);
      const failure = {
        leaseId: claimed!.leaseId!,
        reason: "send" as const,
        permanent: false,
      };
      const failed = await repository.failNotificationDelivery(
        input.key,
        failure,
      );
      currentTime += 1;
      assertEquals(
        await repository.failNotificationDelivery(input.key, failure),
        failed,
      );
      assertEquals(await repository.claimNotificationDelivery(input.key), null);
      if (attempt < 6) {
        assertEquals(failed.status, "pending");
        assertEquals(
          failed.nextAttemptAt,
          currentTime - 1 + 30_000 * 2 ** (attempt - 1),
        );
        currentTime = failed.nextAttemptAt;
      } else {
        assertEquals(failed.status, "failed");
        assertEquals(failed.reason, "attempt_limit");
      }
    }
    assertEquals(await repository.getPendingNotificationDeliveries(), []);
  });

  test("6回目のclaim後にworkerが停止すると、期限後に無限claimせず失敗へ収束する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    let currentTime = now;
    using _clock = stub(Date, "now", () => currentTime);
    const repository = createNotificationDeliveriesRepository(database.db);
    await repository.prepareNotificationDelivery(input);

    // Act
    for (let attempt = 1; attempt <= 6; attempt++) {
      assertEquals(
        (await repository.claimNotificationDelivery(input.key))?.attempts,
        attempt,
      );
      currentTime += 120_000;
    }

    // Assert
    assertEquals(await repository.claimNotificationDelivery(input.key), null);
    assertEquals(
      (await repository.prepareNotificationDelivery(input)).status,
      "failed",
    );
    assertEquals(await repository.getPendingNotificationDeliveries(), []);
  });

  test("恒久的な配送失敗は次回を予約せず、別leaseによる状態更新を拒否する", async () => {
    // Arrange
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount({
      discordId: "user-1",
      puuid: "puuid-1",
      gameName: "Player",
      tagLine: "JP1",
      platform: "jp1",
      region: "asia",
    });
    await database.actions.upsertMatchWatcher({
      guildId: "guild-1",
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
    using _clock = stub(Date, "now", () => now);
    const repository = createNotificationDeliveriesRepository(database.db);
    await repository.prepareNotificationDelivery(input);
    const claimed = await repository.claimNotificationDelivery(input.key);

    // Act
    await assertRejects(() =>
      repository.failNotificationDelivery(input.key, {
        leaseId: "wrong-lease",
        reason: "channel_missing",
        permanent: true,
      }), DomainConflictError);
    const failed = await repository.failNotificationDelivery(input.key, {
      leaseId: claimed!.leaseId!,
      reason: "channel_missing",
      permanent: true,
    });

    // Assert
    assertEquals(failed.status, "failed");
    assertEquals(failed.reason, "channel_missing");
    assertEquals(await repository.claimNotificationDelivery(input.key), null);
  });
});

test("結果が先に準備された場合、後着の古い進捗とpendingを失効させ別試合・別guildの通知を保持する", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "user-1",
    puuid: "puuid-1",
    gameName: "A",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  for (const guildId of ["guild-1", "guild-2"]) {
    await db.actions.upsertMatchWatcher({
      guildId,
      targetDiscordId: "user-1",
      requesterId: "user-1",
      channelId: "channel-1",
    });
  }
  const repository = createNotificationDeliveriesRepository(db.db);
  await repository.prepareNotificationDelivery(input);
  // Act & Assert
  for (const stage of [0, 1, 2]) {
    const old = await repository.prepareNotificationDelivery({
      ...input,
      key: `old-${stage}`,
      stage,
    });
    assertEquals(old.reason, "superseded");
    assertEquals(await repository.claimNotificationDelivery(old.key), null);
  }
  for (const change of [{ matchId: "JP1_456" }, { guildId: "guild-2" }]) {
    const other = await repository.prepareNotificationDelivery({
      ...input,
      ...change,
      key: JSON.stringify(change),
      stage: 0,
    });
    assertEquals(other.status, "pending");
    assertEquals(
      (await repository.claimNotificationDelivery(other.key))?.key,
      other.key,
    );
  }
});

test("古い編集のleaseが有効な場合、結果配送は完了を待ち、その後は旧配送をclaimできない", async () => {
  // Arrange
  await using db = await createMigratedTestDatabase();
  await db.actions.upsertRiotAccount({
    discordId: "user-1",
    puuid: "puuid-1",
    gameName: "A",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
  });
  await db.actions.upsertMatchWatcher({
    guildId: "guild-1",
    targetDiscordId: "user-1",
    requesterId: "user-1",
    channelId: "channel-1",
  });
  const repository = createNotificationDeliveriesRepository(db.db);
  const old = await repository.prepareNotificationDelivery({
    ...input,
    key: "progress",
    stage: 0,
    messageId: "message",
  });
  const lease = await repository.claimNotificationDelivery(old.key);
  await repository.prepareNotificationDelivery({
    ...input,
    messageId: "message",
  });
  // Act & Assert
  assertEquals(await repository.claimNotificationDelivery(input.key), null);
  await repository.completeNotificationDelivery(old.key, {
    leaseId: lease!.leaseId!,
    messageId: "message",
  });
  assertEquals(
    (await repository.claimNotificationDelivery(input.key))?.key,
    input.key,
  );
  assertEquals(await repository.claimNotificationDelivery(old.key), null);
});
