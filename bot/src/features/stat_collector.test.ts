import { assertEquals, assertStrictEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import {
  type Channel,
  Collection,
  type Message,
  type Snowflake,
} from "discord.js";
import { messageKeys } from "../messages.ts";
import { MockInteractionBuilder } from "../test_utils.ts";
import { statCollector } from "./stat_collector.ts";

type CollectorEndListener = (
  collected: Collection<Snowflake, Message>,
  reason: string,
) => void;

type TestCollector = {
  on(event: "end", listener: CollectorEndListener): TestCollector;
};

type TestChannel = {
  id: string;
  createMessageCollector(options: unknown): TestCollector;
};

function testMessage(content: string): Message {
  return {
    author: { id: "mock-user-id" },
    content,
    delete: () => Promise.resolve({} as Message),
  } as unknown as Message;
}

function collectorEndingWith(
  messages: Message[],
  reason = "limit",
): TestCollector {
  const collected = new Collection<Snowflake, Message>();
  messages.forEach((message, index) => {
    collected.set(`message-${index}`, message);
  });
  const collector: TestCollector = {
    on(_event, listener) {
      listener(collected, reason);
      return collector;
    },
  };
  return collector;
}

function createInteraction() {
  const channel: TestChannel = {
    id: "mock-channel-id",
    createMessageCollector: () => collectorEndingWith([], "time"),
  };
  const interaction = new MockInteractionBuilder("record-match")
    .withChannel(channel as unknown as Channel)
    .build();
  return { channel, interaction };
}

describe("stat collector", () => {
  describe("正常系", () => {
    test("KDA形式のメッセージを受信したとき、文字列のvalue結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([testMessage("10/2/8")]),
      );

      // Act
      const result = await statCollector.askForStat<string>(
        interaction,
        "Player1",
        /^\d+\/\d+\/\d+$/,
        messageKeys.matchManagement.recordMatch.promptKDA,
        messageKeys.matchManagement.recordMatch.invalidFormatKDA,
      );

      // Assert
      assertEquals(result, { status: "value", value: "10/2/8" });
    });

    test("数値形式のメッセージを受信したとき、数値のvalue結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([testMessage("123")]),
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );

      // Assert
      assertEquals(result, { status: "value", value: 123 });
    });

    for (
      const { label, content, validation, promptKey, errorKey, value } of [
        {
          label: "KDA",
          content: "10/2/8",
          validation: /^\d+\/\d+\/\d+$/,
          promptKey: messageKeys.matchManagement.recordMatch.promptKDA,
          errorKey: messageKeys.matchManagement.recordMatch.invalidFormatKDA,
          value: "10/2/8",
        },
        {
          label: "CS",
          content: "200",
          validation: /^\d+$/,
          promptKey: messageKeys.matchManagement.recordMatch.promptCS,
          errorKey: messageKeys.matchManagement.recordMatch.invalidFormatNumber,
          value: 200,
        },
        {
          label: "Gold",
          content: "12000",
          validation: /^\d+$/,
          promptKey: messageKeys.matchManagement.recordMatch.promptGold,
          errorKey: messageKeys.matchManagement.recordMatch.invalidFormatNumber,
          value: 12000,
        },
      ]
    ) {
      test(`${label}入力の削除が権限不足で失敗しても、有効なvalue結果を返す`, async () => {
        // Arrange
        const { channel, interaction } = createInteraction();
        const message = testMessage(content);
        using deleteStub = stub(
          message,
          "delete",
          () => Promise.reject(new Error("Missing Permissions")),
        );
        using _collectorStub = stub(
          channel,
          "createMessageCollector",
          () => collectorEndingWith([message]),
        );

        // Act
        const result = await statCollector.askForStat(
          interaction,
          "Player1",
          validation,
          promptKey,
          errorKey,
        );

        // Assert
        assertEquals(result, { status: "value", value });
        assertSpyCalls(deleteStub, 1);
      });
    }

    test("不正な入力の削除が失敗しても、警告後に再試行して有効なvalue結果を返す", async () => {
      // Arrange
      using time = new FakeTime();
      const { channel, interaction } = createInteraction();
      const invalidMessage = testMessage("invalid");
      using _deleteStub = stub(
        invalidMessage,
        "delete",
        () => Promise.reject(new Error("Missing Permissions")),
      );
      const collectors = [
        collectorEndingWith([invalidMessage]),
        collectorEndingWith([testMessage("456")]),
      ];
      using collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectors.shift()!,
      );
      const deleteWarning = spy(() => Promise.resolve({} as Message));
      using followUpStub = stub(
        interaction,
        "followUp",
        () => Promise.resolve({ delete: deleteWarning } as unknown as Message),
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );
      time.tick(5_000);

      // Assert
      assertEquals(result, { status: "value", value: 456 });
      assertSpyCalls(collectorStub, 2);
      assertSpyCalls(followUpStub, 1);
      assertSpyCalls(deleteWarning, 1);
    });
  });

  describe("中断・異常系", () => {
    test("collectorがtime理由で終了したとき、timeout結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([], "time"),
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );

      // Assert
      assertEquals(result, { status: "timeout" });
    });

    test("前後空白と大文字小文字を含むcancelを受信したとき、cancelled結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([testMessage("  CaNcEl  ")]),
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );

      // Assert
      assertEquals(result, { status: "cancelled" });
    });

    test("前後空白を含むキャンセルを受信したとき、cancelled結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([testMessage("  キャンセル  ")]),
      );

      // Act
      const result = await statCollector.askForStat<string>(
        interaction,
        "Player1",
        /^\d+\/\d+\/\d+$/,
        messageKeys.matchManagement.recordMatch.promptKDA,
        messageKeys.matchManagement.recordMatch.invalidFormatKDA,
      );

      // Assert
      assertEquals(result, { status: "cancelled" });
    });

    test("collectorがtime以外の理由でメッセージなしに終了したとき、failure結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => collectorEndingWith([], "user"),
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );

      // Assert
      assertEquals(result.status, "failure");
    });

    test("collector処理が例外を投げたとき、同じerrorを持つfailure結果を返す", async () => {
      // Arrange
      const { channel, interaction } = createInteraction();
      const error = new Error("Discord collector failed");
      using _collectorStub = stub(
        channel,
        "createMessageCollector",
        () => {
          throw error;
        },
      );

      // Act
      const result = await statCollector.askForStat<number>(
        interaction,
        "Player1",
        /^\d+$/,
        messageKeys.matchManagement.recordMatch.promptCS,
        messageKeys.matchManagement.recordMatch.invalidFormatNumber,
      );

      // Assert
      assertEquals(result.status, "failure");
      if (result.status === "failure") {
        assertStrictEquals(result.error, error);
      }
    });
  });
});
