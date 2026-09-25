import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { DomainConflictError, RecordNotFoundError } from "../errors.ts";
import { createMigratedTestDatabase } from "./integration_test_harness.ts";

function account(puuid: string, discordId = "owner") {
  return {
    discordId,
    puuid,
    gameName: puuid,
    tagLine: "JP1",
    platform: "jp1" as const,
    region: "asia" as const,
  };
}

describe("複数Riot accountの所有権とmain", () => {
  test("同じDiscordユーザーが2 accountを登録すると、初回mainを保持して両方を一覧できる", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("first"));
    await database.actions.upsertRiotAccount(account("second"));
    const accounts = await database.actions.getRiotAccountsByDiscordId("owner");
    assertEquals(accounts.map(({ puuid, isMain }) => ({ puuid, isMain })), [{
      puuid: "first",
      isMain: true,
    }, { puuid: "second", isMain: false }]);
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId("owner"))?.puuid,
      "first",
    );
  });

  test("登録済みPUUIDで表示名を更新すると、identityとmainを保って同じaccountを更新する", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("first"));
    await database.actions.upsertRiotAccount({
      ...account("first"),
      gameName: "Renamed",
    });
    const accounts = await database.actions.getRiotAccountsByDiscordId("owner");
    assertEquals(accounts.length, 1);
    assertEquals(accounts[0].gameName, "Renamed");
    assertEquals(accounts[0].isMain, true);
  });

  test("別DiscordユーザーのPUUIDを登録すると、所有権の付け替えを拒否して元accountを保つ", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("first"));
    await assertRejects(
      () => database.actions.upsertRiotAccount(account("first", "other")),
      DomainConflictError,
    );
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId("owner"))?.puuid,
      "first",
    );
    assertEquals(
      await database.actions.getRiotAccountsByDiscordId("other"),
      [],
    );
  });

  test("main変更後にmainを削除すると、残るaccountだけをmainへ昇格し最後の削除で空になる", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("first"));
    await database.actions.upsertRiotAccount(account("second"));
    await database.actions.setMainRiotAccount("owner", "second");
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId("owner"))?.puuid,
      "second",
    );
    await database.actions.deleteRiotAccount("owner", "second");
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId("owner"))?.puuid,
      "first",
    );
    await database.actions.deleteRiotAccount("owner", "first");
    assertEquals(
      await database.actions.getRiotAccountsByDiscordId("owner"),
      [],
    );
  });

  test("別ユーザーがmain変更や解除を試みると、所有者のaccountを変更しない", async () => {
    await using database = await createMigratedTestDatabase();
    await database.actions.upsertRiotAccount(account("first"));
    await assertRejects(
      () => database.actions.setMainRiotAccount("other", "first"),
      RecordNotFoundError,
    );
    await assertRejects(
      () => database.actions.deleteRiotAccount("other", "first"),
      RecordNotFoundError,
    );
    assertEquals(
      (await database.actions.getRiotAccountByDiscordId("owner"))?.puuid,
      "first",
    );
  });
});
