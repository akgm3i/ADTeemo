import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { createApp } from "../../api/src/app.ts";
import { createTestDependencies } from "../../api/src/test_utils.ts";
import { createMigratedTestDatabase } from "../../api/src/db/integration_test_harness.ts";
import { createInProcessBotApiClient } from "./test_utils.ts";
describe("Bot client→監視policy API→migrated SQLite", () => {
  test("所属同期と通知先を保存すると全accountを監視し、本人opt-outで全て停止する", async () => {
    await using db = await createMigratedTestDatabase();
    for (const puuid of ["main", "sub"]) {
      await db.actions.upsertRiotAccount({
        discordId: "owner",
        puuid,
        gameName: puuid,
        tagLine: "JP1",
        platform: "jp1",
        region: "asia",
      });
    }
    const client = createInProcessBotApiClient(
      createApp(createTestDependencies({ dbActions: db.actions })),
    );
    assertEquals(
      (await client.syncGuildMatchWatchMembers("guild", ["owner"])).success,
      true,
    );
    assertEquals(
      await client.setGuildMatchWatchSettings({
        guildId: "guild",
        enabled: true,
        notificationChannelId: "channel",
      }),
      {
        success: true,
        settings: {
          guildId: "guild",
          enabled: true,
          notificationChannelId: "channel",
        },
        limitedAccountCount: 0,
      },
    );
    const watchers = await client.getEnabledMatchWatchersByGuild("guild");
    assertEquals(
      watchers.success &&
        watchers.watchers.map((w) => w.riotAccountPuuid).sort(),
      ["main", "sub"],
    );
    assertEquals(
      (await client.setMatchWatchOptOut("guild", "owner", true)).success,
      true,
    );
    assertEquals(await client.getEnabledMatchWatchersByGuild("guild"), {
      success: true,
      watchers: [],
    });
    const selected = await client.getRiotAccount("owner", "sub");
    assertEquals(selected.success && selected.account.puuid, "sub");
    assertEquals(selected.success && selected.account.isMain, false);
    assertEquals((await client.getRiotAccount("other", "sub")).success, false);
    assertEquals(
      (await client.setMainRiotAccount("owner", "sub")).success,
      true,
    );
    const main = await client.getRiotAccount("owner");
    assertEquals(main.success && main.account.puuid, "sub");
    const accounts = await client.getRiotAccounts("owner");
    assertEquals(accounts.success && accounts.accounts.length, 2);
    assertEquals(
      (await client.deleteRiotAccount("other", "sub")).success,
      false,
    );
    assertEquals(
      (await client.deleteRiotAccount("owner", "sub")).success,
      true,
    );
    const final = await client.getRiotAccounts("owner");
    assertEquals(final.success && final.accounts.map((a) => a.puuid), ["main"]);
  });
});
