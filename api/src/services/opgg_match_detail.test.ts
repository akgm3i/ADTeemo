import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, stub } from "@std/testing/mock";
import { dbActions } from "../db/default_actions.ts";
import type { RiotAccount } from "../db/schema.ts";
import {
  OpggMatchParticipantMismatchError,
  RecordNotFoundError,
} from "../errors.ts";
import { opggClient, type OpggMatchDetail } from "../integrations/opgg.ts";
import { apiLogger } from "../logger.ts";
import { resolveAndSaveOpggMatchDetail } from "./opgg_match_detail.ts";

function account(overrides: Partial<RiotAccount> = {}): RiotAccount {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    discordId: "target-1",
    puuid: "puuid-1",
    gameName: "Teemo",
    tagLine: "JP1",
    platform: "jp1",
    region: "asia",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function input(overrides: {
  targetDiscordId?: string;
  participantPuuid?: string;
} = {}) {
  return {
    matchId: "JP1_12345",
    targetDiscordId: overrides.targetDiscordId ?? "target-1",
    match: {
      gameCreation: new Date("2026-06-19T00:00:00.000Z").getTime(),
      gameDuration: 1800,
      queueId: 420,
      participant: {
        puuid: overrides.participantPuuid ?? "puuid-1",
        championId: 17,
        championName: "Teemo",
      },
    },
  };
}

function detail(): OpggMatchDetail {
  return {
    provider: "opgg",
    providerRegion: "jp",
    providerMatchId: "opgg-match-1",
    detailUrl:
      "https://op.gg/ja/lol/summoners/jp/Teemo-JP1/matches/opgg-match-1/1781827200000",
    providerCreatedAt: new Date("2026-06-19T00:00:00.000Z"),
    averageTier: "Emerald",
    participant: {
      puuid: "puuid-1",
      participantId: 3,
      laneScore: 7.2,
    },
  };
}

async function withOpggEnabled<T>(
  enabled: boolean,
  action: () => Promise<T>,
) {
  const original = Deno.env.get("OPGG_ENABLED");
  enabled
    ? Deno.env.set("OPGG_ENABLED", "true")
    : Deno.env.delete("OPGG_ENABLED");
  try {
    return await action();
  } finally {
    original === undefined
      ? Deno.env.delete("OPGG_ENABLED")
      : Deno.env.set("OPGG_ENABLED", original);
  }
}

describe("OP.GG試合詳細service", () => {
  test("OP.GG連携が無効なとき、アカウント取得と外部解決と保存を行わずnullを返す", async () => {
    // Arrange
    using accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );
    using resolveStub = stub(
      opggClient,
      "resolveMatchDetail",
      () => Promise.resolve(detail()),
    );
    using saveStub = stub(
      dbActions,
      "upsertExternalMatchDetail",
      () => Promise.resolve(),
    );

    // Act
    const result = await withOpggEnabled(
      false,
      () => resolveAndSaveOpggMatchDetail(input()),
    );

    // Assert
    assertEquals(result, null);
    assertSpyCalls(accountStub, 0);
    assertSpyCalls(resolveStub, 0);
    assertSpyCalls(saveStub, 0);
  });

  test("対象DiscordユーザーのRiotアカウントがないとき、RecordNotFoundErrorを返す", async () => {
    // Arrange
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(undefined),
    );

    // Act / Assert
    await withOpggEnabled(true, () =>
      assertRejects(
        () => resolveAndSaveOpggMatchDetail(input()),
        RecordNotFoundError,
        "Riot account not found",
      ));
  });

  test("保存対象参加者とRiotアカウントのPUUIDが異なるとき、専用errorを返す", async () => {
    // Arrange
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );

    // Act / Assert
    await withOpggEnabled(true, () =>
      assertRejects(
        () =>
          resolveAndSaveOpggMatchDetail(
            input({ participantPuuid: "different-puuid" }),
          ),
        OpggMatchParticipantMismatchError,
      ));
  });

  test("OP.GGに該当試合がないとき、保存を行わずnullを返す", async () => {
    // Arrange
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );
    using _resolveStub = stub(
      opggClient,
      "resolveMatchDetail",
      () => Promise.resolve(null),
    );
    using saveStub = stub(
      dbActions,
      "upsertExternalMatchDetail",
      () => Promise.resolve(),
    );

    // Act
    const result = await withOpggEnabled(
      true,
      () => resolveAndSaveOpggMatchDetail(input()),
    );

    // Assert
    assertEquals(result, null);
    assertSpyCalls(saveStub, 0);
  });

  test("OP.GGの外部解決が失敗したとき、警告を記録して保存せずnullを返す", async () => {
    // Arrange
    const error = new Error("OP.GG unavailable");
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );
    using _resolveStub = stub(
      opggClient,
      "resolveMatchDetail",
      () => Promise.reject(error),
    );
    using saveStub = stub(
      dbActions,
      "upsertExternalMatchDetail",
      () => Promise.resolve(),
    );
    using warnStub = stub(apiLogger, "warn");

    // Act
    const result = await withOpggEnabled(
      true,
      () => resolveAndSaveOpggMatchDetail(input()),
    );

    // Assert
    assertEquals(result, null);
    assertSpyCalls(saveStub, 0);
    assertSpyCall(warnStub, 0, {
      args: ["opgg_match_detail.resolve_failed", {
        targetDiscordId: "target-1",
        matchId: "JP1_12345",
        error: "OP.GG unavailable",
      }],
    });
  });

  test("OP.GG詳細を解決できたとき、外部試合詳細を保存して同じ詳細を返す", async () => {
    // Arrange
    const resolved = detail();
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );
    using resolveStub = stub(
      opggClient,
      "resolveMatchDetail",
      () => Promise.resolve(resolved),
    );
    using saveStub = stub(
      dbActions,
      "upsertExternalMatchDetail",
      () => Promise.resolve(),
    );

    // Act
    const result = await withOpggEnabled(
      true,
      () => resolveAndSaveOpggMatchDetail(input()),
    );

    // Assert
    assertEquals(result, resolved);
    assertSpyCall(resolveStub, 0, {
      args: [account(), {
        metadata: { matchId: "JP1_12345" },
        info: {
          gameCreation: input().match.gameCreation,
          gameDuration: 1800,
          queueId: 420,
          participants: [input().match.participant],
        },
      }],
    });
    assertSpyCall(saveStub, 0, {
      args: [{ matchId: "JP1_12345", ...resolved }],
    });
  });

  test("OP.GG詳細の保存が失敗したとき、保存errorを呼び出し元へ伝播する", async () => {
    // Arrange
    const saveError = new Error("database unavailable");
    using _accountStub = stub(
      dbActions,
      "getRiotAccountByDiscordId",
      () => Promise.resolve(account()),
    );
    using _resolveStub = stub(
      opggClient,
      "resolveMatchDetail",
      () => Promise.resolve(detail()),
    );
    using _saveStub = stub(
      dbActions,
      "upsertExternalMatchDetail",
      () => Promise.reject(saveError),
    );

    // Act / Assert
    await withOpggEnabled(true, () =>
      assertRejects(
        () => resolveAndSaveOpggMatchDetail(input()),
        Error,
        "database unavailable",
      ));
  });
});
