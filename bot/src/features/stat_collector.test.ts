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

    test("不正な入力の後に有効な入力を受信したとき、警告後に再試行してvalue結果を返す", async () => {
      // Arrange
      using time = new FakeTime();
      const { channel, interaction } = createInteraction();
      const collectors = [
        collectorEndingWith([testMessage("invalid")]),
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
