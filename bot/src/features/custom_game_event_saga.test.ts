import type { Event } from "@adteemo/api/contract";
import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  createCustomGameEventSaga,
  type CustomGameEventSagaApi,
  CustomGameEventSagaError,
  isDiscordResourceAlreadyDeleted,
} from "./custom_game_event_saga.ts";

type PrepareInput = Parameters<
  CustomGameEventSagaApi["prepareCustomGameEvent"]
>[0];
type CreationProgressInput = Parameters<
  CustomGameEventSagaApi["updateCustomGameEventCreationProgress"]
>[1];
type CreationFailureInput = Parameters<
  CustomGameEventSagaApi["markCustomGameEventCreationFailed"]
>[1];
type EventScope = Parameters<
  CustomGameEventSagaApi["activateCustomGameEvent"]
>[1];
type CancellationProgressInput = Parameters<
  CustomGameEventSagaApi["updateCustomGameEventCancellationProgress"]
>[1];

const scheduledStartAt = new Date("2026-08-08T12:00:00.000Z");

function resolved<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function eventFixture(overrides: Partial<Event> = {}): Event {
  return {
    id: 113,
    operationKey: "interaction-113",
    name: "週末カスタム",
    guildId: "guild-1",
    creatorId: "creator-1",
    recruitmentChannelId: "channel-1",
    voiceChannelId: "voice-1",
    discordScheduledEventId: null,
    recruitmentMessageId: null,
    phase: "PREPARING",
    syncState: "CREATE_PENDING",
    revision: 0,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    scheduledStartAt,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: null,
    ...overrides,
  };
}

const createInput = {
  operationKey: "interaction-113",
  name: "週末カスタム",
  guildId: "guild-1",
  creatorId: "creator-1",
  recruitmentChannelId: "channel-1",
  voiceChannelId: "voice-1",
  scheduledStartAt,
  recruitmentMessageContent: "募集します",
};

type FakeApiOptions = {
  initialEvent?: Event;
  preparedCreated?: boolean;
  resultFailures?: readonly string[];
  serverFailures?: readonly string[];
  ambiguousFailures?: readonly string[];
  ambiguousFailuresOnce?: readonly string[];
  ambiguousFailureCounts?: Readonly<Record<string, number>>;
  thrownFailures?: Readonly<Record<string, Error>>;
  activateBeforeCreationFailureClaim?: boolean;
  cancelBeforeDiscordEventCheckpoint?: boolean;
  cancelPendingBeforeDiscordEventCheckpoint?: boolean;
};

function fakeApi(
  order: string[],
  options: FakeApiOptions = {},
) {
  let current = options.initialEvent ?? eventFixture();
  const remainingOneTimeAmbiguousFailures = new Set(
    options.ambiguousFailuresOnce,
  );
  const remainingAmbiguousFailureCounts = new Map(
    Object.entries(options.ambiguousFailureCounts ?? {}),
  );
  const creationFailureInputs: CreationFailureInput[] = [];
  const cancellationProgressInputs: CancellationProgressInput[] = [];

  function failure(label: string) {
    const thrown = options.thrownFailures?.[label];
    if (thrown) throw thrown;
    if (options.resultFailures?.includes(label)) {
      return {
        success: false as const,
        error: `${label} failed`,
        code: "CONFLICT" as const,
        status: 409 as const,
      };
    }
    if (options.serverFailures?.includes(label)) {
      return {
        success: false as const,
        error: `${label} failed`,
        code: "INTERNAL_ERROR" as const,
        status: 500 as const,
      };
    }
    if (
      options.ambiguousFailures?.includes(label) ||
      remainingOneTimeAmbiguousFailures.delete(label)
    ) {
      return { success: false as const, error: `${label} ambiguous` };
    }
    const remainingAmbiguousFailures =
      remainingAmbiguousFailureCounts.get(label) ?? 0;
    if (remainingAmbiguousFailures > 0) {
      remainingAmbiguousFailureCounts.set(
        label,
        remainingAmbiguousFailures - 1,
      );
      return { success: false as const, error: `${label} ambiguous` };
    }
    return null;
  }

  const api = {
    prepareCustomGameEvent(_input: PrepareInput) {
      order.push("DB準備");
      const failed = failure("prepare");
      if (failed) return resolved(failed);
      return resolved({
        success: true as const,
        created: options.preparedCreated ?? true,
        event: current,
      });
    },
    updateCustomGameEventCreationProgress(
      _eventId: number,
      input: CreationProgressInput,
    ) {
      const isDiscordEvent = input.discordScheduledEventId !== undefined;
      const label = isDiscordEvent
        ? "checkpoint-discord-event"
        : "checkpoint-message";
      order.push(isDiscordEvent ? "イベントID保存" : "メッセージID保存");
      if (
        isDiscordEvent && options.cancelBeforeDiscordEventCheckpoint
      ) {
        current = {
          ...current,
          phase: "CANCELLED",
          syncState: "CONSISTENT",
          discordEventDeleted: true,
          recruitmentMessageDeleted: true,
        };
        return resolved({
          success: false as const,
          error: "event was cancelled",
          code: "CONFLICT" as const,
          status: 409 as const,
        });
      }
      if (
        isDiscordEvent && options.cancelPendingBeforeDiscordEventCheckpoint
      ) {
        current = {
          ...current,
          phase: "PREPARING",
          syncState: "CANCEL_PENDING",
        };
        return resolved({
          success: false as const,
          error: "event cancellation started",
          code: "CONFLICT" as const,
          status: 409 as const,
        });
      }
      const failed = failure(label);
      if (failed) return resolved(failed);
      current = {
        ...current,
        discordScheduledEventId: input.discordScheduledEventId ??
          current.discordScheduledEventId,
        recruitmentMessageId: input.recruitmentMessageId ??
          current.recruitmentMessageId,
      };
      return resolved({ success: true as const, event: current });
    },
    activateCustomGameEvent(_eventId: number, _scope: EventScope) {
      order.push("整合済みに更新");
      const failed = failure("activate");
      if (failed) return resolved(failed);
      current = {
        ...current,
        phase: "RECRUITING",
        syncState: "CONSISTENT",
      };
      return resolved({ success: true as const, event: current });
    },
    markCustomGameEventCreationFailed(
      _eventId: number,
      input: CreationFailureInput,
    ) {
      order.push("作成失敗を保存");
      creationFailureInputs.push(input);
      if (current.phase === "CANCELLED") {
        return resolved({ success: true as const, event: current });
      }
      if (
        options.activateBeforeCreationFailureClaim &&
        current.syncState === "CREATE_PENDING"
      ) {
        current = {
          ...current,
          phase: "RECRUITING",
          syncState: "CONSISTENT",
        };
        return resolved({
          success: false as const,
          error: "creation failure claim conflicted",
          code: "CONFLICT" as const,
          status: 409 as const,
        });
      }
      if (
        current.phase !== "PREPARING" ||
        (current.syncState !== "CREATE_PENDING" &&
          current.syncState !== "CREATE_COMPENSATION_PENDING") ||
        (input.discordScheduledEventId &&
          current.discordScheduledEventId &&
          input.discordScheduledEventId !==
            current.discordScheduledEventId) ||
        (input.recruitmentMessageId && current.recruitmentMessageId &&
          input.recruitmentMessageId !== current.recruitmentMessageId)
      ) {
        return resolved({
          success: false as const,
          error: "creation failure claim conflicted",
          code: "CONFLICT" as const,
          status: 409 as const,
        });
      }
      const failed = failure("mark-creation-failed");
      if (failed) return resolved(failed);
      const discordScheduledEventId = input.discordScheduledEventId ??
        current.discordScheduledEventId;
      const recruitmentMessageId = input.recruitmentMessageId ??
        current.recruitmentMessageId;
      const compensated = input.discordEventDeleted &&
        input.recruitmentMessageDeleted;
      current = {
        ...current,
        discordScheduledEventId,
        recruitmentMessageId,
        discordEventDeleted: input.discordEventDeleted,
        recruitmentMessageDeleted: input.recruitmentMessageDeleted,
        phase: compensated ? "CANCELLED" : "PREPARING",
        syncState: compensated ? "CONSISTENT" : "CREATE_COMPENSATION_PENDING",
        lastFailureCode: input.failureCode,
      };
      return resolved({ success: true as const, event: current });
    },
    beginCustomGameEventCancellation(
      _eventId: number,
      _scope: EventScope,
    ) {
      order.push("中止開始を保存");
      const failed = failure("begin-cancellation");
      if (failed) return resolved(failed);
      if (current.phase !== "CANCELLED" || current.syncState !== "CONSISTENT") {
        current = { ...current, syncState: "CANCEL_PENDING" };
      }
      return resolved({ success: true as const, event: current });
    },
    updateCustomGameEventCancellationProgress(
      _eventId: number,
      input: CancellationProgressInput,
    ) {
      cancellationProgressInputs.push(input);
      if (input.discordScheduledEventId) order.push("中止イベントID保存");
      if (input.recruitmentMessageId) order.push("中止メッセージID保存");
      if (input.discordEventDeleted) order.push("イベント削除を保存");
      if (input.recruitmentMessageDeleted) order.push("メッセージ削除を保存");
      if (input.failureCode) order.push("中止失敗を保存");
      const label = input.failureCode
        ? "record-cancellation-failed"
        : input.discordScheduledEventId
        ? "checkpoint-discord-event-cancellation-target"
        : input.recruitmentMessageId
        ? "checkpoint-message-cancellation-target"
        : input.discordEventDeleted
        ? "checkpoint-discord-event-deletion"
        : "checkpoint-message-deletion";
      const failed = failure(label);
      if (failed) return resolved(failed);

      if (
        (input.discordScheduledEventId &&
          current.discordScheduledEventId &&
          input.discordScheduledEventId !== current.discordScheduledEventId) ||
        (input.recruitmentMessageId && current.recruitmentMessageId &&
          input.recruitmentMessageId !== current.recruitmentMessageId)
      ) {
        return resolved({
          success: false as const,
          error: "cancellation target changed",
          code: "CONFLICT" as const,
          status: 409 as const,
        });
      }

      const discordEventDeleted = current.discordEventDeleted ||
        input.discordEventDeleted === true;
      const recruitmentMessageDeleted = current.recruitmentMessageDeleted ||
        input.recruitmentMessageDeleted === true;
      const completed = discordEventDeleted && recruitmentMessageDeleted;
      current = {
        ...current,
        discordScheduledEventId: input.discordScheduledEventId ??
          current.discordScheduledEventId,
        recruitmentMessageId: input.recruitmentMessageId ??
          current.recruitmentMessageId,
        discordEventDeleted,
        recruitmentMessageDeleted,
        lastFailureCode: input.failureCode === undefined
          ? current.lastFailureCode
          : input.failureCode,
        phase: completed ? "CANCELLED" : current.phase,
        syncState: completed ? "CONSISTENT" : "CANCEL_PENDING",
      };
      return resolved({ success: true as const, event: current });
    },
  } as unknown as CustomGameEventSagaApi;

  return {
    api,
    creationFailureInputs,
    cancellationProgressInputs,
  };
}

type FakeEffectsOptions = {
  failures?: Readonly<Record<string, Error>>;
  foundScheduledEventId?: string | null;
  foundRecruitmentMessageId?: string | null;
};

function fakeEffects(order: string[], options: FakeEffectsOptions = {}) {
  function fail(label: string) {
    const error = options.failures?.[label];
    if (error) throw error;
  }

  return {
    createScheduledEvent(input: { operationKey: string }) {
      order.push(`Discordイベント作成:${input.operationKey}`);
      fail("create-discord-event");
      return resolved({ id: "discord-event-1" });
    },
    createRecruitmentMessage(
      input: { content: string; nonce: string; createdAfter: Date },
    ) {
      order.push(`募集メッセージ作成:${input.nonce}`);
      fail("create-message");
      return resolved({ id: "message-1" });
    },
    addRecruitmentReactions(_messageId: string) {
      order.push("リアクション追加");
      fail("add-reactions");
      return resolved(undefined);
    },
    findScheduledEvent() {
      order.push("Discordイベント検索");
      fail("find-discord-event");
      return resolved(
        options.foundScheduledEventId
          ? { id: options.foundScheduledEventId }
          : null,
      );
    },
    findRecruitmentMessage() {
      order.push("募集メッセージ検索");
      fail("find-message");
      return resolved(
        options.foundRecruitmentMessageId
          ? { id: options.foundRecruitmentMessageId }
          : null,
      );
    },
    deleteScheduledEvent(_discordScheduledEventId: string) {
      order.push("Discordイベント削除");
      fail("delete-discord-event");
      return resolved(undefined);
    },
    deleteRecruitmentMessage(_recruitmentMessageId: string) {
      order.push("募集メッセージ削除");
      fail("delete-message");
      return resolved(undefined);
    },
  };
}

describe("カスタムゲームイベントサーガ", () => {
  describe("作成", () => {
    test("DBへの作成意図の保存が失敗した状況で作成すると、Discord副作用を実行しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, { resultFailures: ["prepare"] });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertInstanceOf(result.error, CustomGameEventSagaError);
      assertEquals(result.error.primaryFailure.step, "PREPARE_EVENT");
      assertEquals(order, ["DB準備"]);
    });

    test("作成意図を保存した状況で作成すると、外部IDを都度保存してから整合済みにする", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order);
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "募集メッセージ作成:interaction-113",
        "メッセージID保存",
        "リアクション追加",
        "整合済みに更新",
      ]);
      if (!result.success) return;
      assertEquals(result.event.phase, "RECRUITING");
      assertEquals(result.event.syncState, "CONSISTENT");
    });

    test("同じoperation keyの作成が同時実行された状況では、処理を共有してDiscordリソースを1組だけ作成する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order);
      const saga = createCustomGameEventSaga(api);
      const effects = fakeEffects(order);

      const first = saga.create(createInput, effects);
      const second = saga.create(createInput, effects);
      const results = await Promise.all([first, second]);

      assertEquals(results.map((result) => result.success), [true, true]);
      assertEquals(order.filter((step) => step === "DB準備").length, 1);
      assertEquals(
        order.filter((step) => step === "Discordイベント作成:interaction-113")
          .length,
        1,
      );
      assertEquals(
        order.filter((step) => step === "募集メッセージ作成:interaction-113")
          .length,
        1,
      );
    });

    test("DiscordイベントID checkpointの応答が2回不明な状況では、同じ既知IDを再送してイベントを重複作成しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        ambiguousFailureCounts: { "checkpoint-discord-event": 2 },
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(
        order.filter((step) => step === "Discordイベント作成:interaction-113")
          .length,
        1,
      );
      assertEquals(
        order.filter((step) => step === "イベントID保存").length,
        3,
      );
    });

    test("募集メッセージID checkpointの応答が2回不明な状況では、同じ既知IDを再送してメッセージを重複作成しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        ambiguousFailureCounts: { "checkpoint-message": 2 },
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(
        order.filter((step) => step === "募集メッセージ作成:interaction-113")
          .length,
        1,
      );
      assertEquals(
        order.filter((step) => step === "メッセージID保存").length,
        3,
      );
    });

    test("再起動後にID未保存のCREATE_PENDINGを再開すると、operation keyで既存resourceを回収してからcheckpointする", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, { preparedCreated: false });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          foundScheduledEventId: "recovered-event",
          foundRecruitmentMessageId: "recovered-message",
        }),
      );

      assertEquals(result.success, true);
      assertEquals(order, [
        "DB準備",
        "Discordイベント検索",
        "イベントID保存",
        "募集メッセージ検索",
        "メッセージID保存",
        "リアクション追加",
        "整合済みに更新",
      ]);
    });

    test("再起動後にID未保存のCREATE_PENDINGでfinderが0件の状況では、新規resourceを作らずpendingを維持する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, { preparedCreated: false });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(
        result.error.primaryFailure.step,
        "FIND_DISCORD_EVENT_CREATION",
      );
      assertEquals(order, ["DB準備", "Discordイベント検索"]);
    });

    test("別Bot instanceで同じoperation keyの作成が競合すると、DB未所有のloser IDだけを削除する", async () => {
      let current = eventFixture();
      const conflict = () => ({
        success: false as const,
        error: "creation progress conflicted",
        code: "CONFLICT" as const,
        status: 409 as const,
      });
      const apiForInstance = () =>
        ({
          prepareCustomGameEvent() {
            return resolved({
              success: true as const,
              created: current.revision === 0,
              event: current,
            });
          },
          updateCustomGameEventCreationProgress(
            _eventId: number,
            input: CreationProgressInput,
          ) {
            if (
              input.discordScheduledEventId &&
              current.discordScheduledEventId &&
              input.discordScheduledEventId !==
                current.discordScheduledEventId
            ) {
              return resolved(conflict());
            }
            if (
              input.recruitmentMessageId && current.recruitmentMessageId &&
              input.recruitmentMessageId !== current.recruitmentMessageId
            ) {
              return resolved(conflict());
            }
            current = {
              ...current,
              discordScheduledEventId: input.discordScheduledEventId ??
                current.discordScheduledEventId,
              recruitmentMessageId: input.recruitmentMessageId ??
                current.recruitmentMessageId,
              revision: current.revision + 1,
            };
            return resolved({ success: true as const, event: current });
          },
          activateCustomGameEvent() {
            current = {
              ...current,
              phase: "RECRUITING",
              syncState: "CONSISTENT",
              revision: current.revision + 1,
            };
            return resolved({ success: true as const, event: current });
          },
          markCustomGameEventCreationFailed(
            _eventId: number,
            input: CreationFailureInput,
          ) {
            if (
              current.phase !== "PREPARING" ||
              (input.discordScheduledEventId &&
                current.discordScheduledEventId &&
                input.discordScheduledEventId !==
                  current.discordScheduledEventId) ||
              (input.recruitmentMessageId && current.recruitmentMessageId &&
                input.recruitmentMessageId !== current.recruitmentMessageId)
            ) {
              return resolved(conflict());
            }
            return resolved({ success: true as const, event: current });
          },
        }) as unknown as CustomGameEventSagaApi;

      let releaseScheduledCreations!: () => void;
      const scheduledCreationsReady = new Promise<void>((resolve) => {
        releaseScheduledCreations = resolve;
      });
      const createdScheduledIds: string[] = [];
      const deletedScheduledIds: string[] = [];
      const effectsForInstance = (
        discordScheduledEventId: string,
        recruitmentMessageId: string,
      ) => ({
        ...fakeEffects([]),
        async createScheduledEvent() {
          createdScheduledIds.push(discordScheduledEventId);
          if (createdScheduledIds.length === 2) releaseScheduledCreations();
          await scheduledCreationsReady;
          return { id: discordScheduledEventId };
        },
        createRecruitmentMessage() {
          return resolved({ id: recruitmentMessageId });
        },
        deleteScheduledEvent(id: string) {
          deletedScheduledIds.push(id);
          return resolved(undefined);
        },
      });
      const firstSaga = createCustomGameEventSaga(apiForInstance());
      const secondSaga = createCustomGameEventSaga(apiForInstance());

      const results = await Promise.all([
        firstSaga.create(
          createInput,
          effectsForInstance("discord-event-a", "message-a"),
        ),
        secondSaga.create(
          createInput,
          effectsForInstance("discord-event-b", "message-b"),
        ),
      ]);

      assertEquals(createdScheduledIds.sort(), [
        "discord-event-a",
        "discord-event-b",
      ]);
      assertEquals(deletedScheduledIds, [
        createdScheduledIds.find((id) =>
          id !== current.discordScheduledEventId
        ),
      ]);
      assertEquals(
        deletedScheduledIds.includes(current.discordScheduledEventId!),
        false,
      );
      assertEquals(results.some((result) => result.success), true);
    });

    test("activate応答を喪失した状況で作成すると、同じ更新を再送してDiscordリソースを削除せず収束する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        ambiguousFailuresOnce: ["activate"],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(creationFailureInputs, []);
      assertEquals(order.slice(-3), [
        "リアクション追加",
        "整合済みに更新",
        "整合済みに更新",
      ]);
      assertEquals(order.includes("募集メッセージ削除"), false);
      assertEquals(order.includes("Discordイベント削除"), false);
    });

    test("activateの5xx応答が再送後も続く状況で作成すると、commit不明のためDiscordリソースを補償しない", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        serverFailures: ["activate"],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error.primaryFailure.step, "ACTIVATE_EVENT");
      assertEquals(creationFailureInputs, []);
      assertEquals(order.slice(-3), [
        "リアクション追加",
        "整合済みに更新",
        "整合済みに更新",
      ]);
      assertEquals(order.includes("募集メッセージ削除"), false);
      assertEquals(order.includes("Discordイベント削除"), false);
    });

    test("募集メッセージIDの保存に失敗した状況で作成すると、メッセージからDiscordイベントの逆順で補償する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        resultFailures: ["checkpoint-message"],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(
        result.error.primaryFailure.step,
        "CHECKPOINT_RECRUITMENT_MESSAGE",
      );
      assertEquals(order.slice(-3), [
        "募集メッセージ削除",
        "Discordイベント削除",
        "作成失敗を保存",
      ]);
      assertEquals(creationFailureInputs, [
        {
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          discordScheduledEventId: "discord-event-1",
          recruitmentMessageId: "message-1",
          discordEventDeleted: false,
          recruitmentMessageDeleted: false,
          failureCode: "CHECKPOINT_RECRUITMENT_MESSAGE_FAILED",
        },
        {
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          discordScheduledEventId: "discord-event-1",
          recruitmentMessageId: "message-1",
          discordEventDeleted: true,
          recruitmentMessageDeleted: true,
          failureCode: "CHECKPOINT_RECRUITMENT_MESSAGE_FAILED",
        },
      ]);
    });

    test("DiscordイベントIDの保存に失敗した状況で作成すると、未作成メッセージの不存在確認とイベント削除を記録する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        resultFailures: ["checkpoint-discord-event"],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "作成失敗を保存",
        "募集メッセージ検索",
        "Discordイベント削除",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs.at(-1)?.discordEventDeleted,
        true,
      );
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageDeleted,
        true,
      );
    });

    test("イベント準備の読取後に中止が完了した状況でDiscordイベントID保存が競合すると、今回判明したIDを削除して失敗を返す", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        cancelBeforeDiscordEventCheckpoint: true,
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(
        result.error.primaryFailure.step,
        "CHECKPOINT_DISCORD_EVENT",
      );
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "作成失敗を保存",
        "Discordイベント削除",
      ]);
    });

    test("イベント準備後に中止開始が競合すると、今回判明したIDを削除済みとしてCANCEL_PENDINGへcheckpointする", async () => {
      const order: string[] = [];
      const { api, cancellationProgressInputs } = fakeApi(order, {
        cancelPendingBeforeDiscordEventCheckpoint: true,
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "作成失敗を保存",
        "DB準備",
        "中止イベントID保存",
        "Discordイベント削除",
        "イベント削除を保存",
      ]);
      assertEquals(cancellationProgressInputs[0], {
        guildId: "guild-1",
        recruitmentChannelId: "channel-1",
        discordScheduledEventId: "discord-event-1",
      });
      assertEquals(cancellationProgressInputs.at(-1), {
        guildId: "guild-1",
        recruitmentChannelId: "channel-1",
        discordEventDeleted: true,
        failureCode: null,
      });
    });

    test("中止競合後に今回IDのcancellation target保存が失敗すると、今回resourceを削除しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        cancelPendingBeforeDiscordEventCheckpoint: true,
        resultFailures: [
          "checkpoint-discord-event-cancellation-target",
        ],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "作成失敗を保存",
        "DB準備",
        "中止イベントID保存",
      ]);
      assertEquals(order.includes("Discordイベント削除"), false);
      assertEquals(
        result.error.recoveryFailures.some((failure) =>
          failure.step ===
            "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET"
        ),
        true,
      );
    });

    test("中止との競合後に今回のDiscordイベント削除が失敗すると、削除失敗を保持して正常終了しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        cancelBeforeDiscordEventCheckpoint: true,
      });
      const saga = createCustomGameEventSaga(api);
      const deleteError = new Error("late event delete failed");

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          failures: { "delete-discord-event": deleteError },
        }),
      );

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error.recoveryFailures, [{
        step: "DELETE_DISCORD_EVENT_COMPENSATION",
        cause: deleteError,
      }]);
    });

    test("募集メッセージ作成の応答が不明な状況では、操作キーでIDを回収して逆順に補償する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order);
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          failures: { "create-message": new Error("network timeout") },
          foundRecruitmentMessageId: "recovered-message",
        }),
      );

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(
        result.error.primaryFailure.step,
        "CREATE_RECRUITMENT_MESSAGE",
      );
      assertEquals(order, [
        "DB準備",
        "Discordイベント作成:interaction-113",
        "イベントID保存",
        "募集メッセージ作成:interaction-113",
        "作成失敗を保存",
        "募集メッセージ検索",
        "作成失敗を保存",
        "募集メッセージ削除",
        "Discordイベント削除",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageId,
        "recovered-message",
      );
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageDeleted,
        true,
      );
      assertEquals(
        creationFailureInputs.at(-1)?.discordEventDeleted,
        true,
      );
    });

    test("補償中にメッセージ削除が失敗した状況でもDiscordイベント削除と失敗状態の保存を継続する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order);
      const saga = createCustomGameEventSaga(api);
      const messageDeleteError = new Error("message deletion failed");

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          failures: {
            "add-reactions": new Error("reaction failed"),
            "delete-message": messageDeleteError,
          },
        }),
      );

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(
        result.error.primaryFailure.step,
        "ADD_RECRUITMENT_REACTIONS",
      );
      assertEquals(result.error.recoveryFailures, [{
        step: "DELETE_RECRUITMENT_MESSAGE_COMPENSATION",
        cause: messageDeleteError,
      }]);
      assertEquals(order.slice(-3), [
        "募集メッセージ削除",
        "Discordイベント削除",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageDeleted,
        false,
      );
      assertEquals(creationFailureInputs.at(-1)?.discordEventDeleted, true);
    });

    test("前回の補償が途中の状況で再実行すると、残っているDiscordリソースだけを削除する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        initialEvent: eventFixture({
          discordScheduledEventId: "discord-event-1",
          recruitmentMessageId: "message-1",
          syncState: "CREATE_COMPENSATION_PENDING",
          discordEventDeleted: true,
          recruitmentMessageDeleted: false,
          lastFailureCode: "ADD_RECRUITMENT_REACTIONS_FAILED",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      assertEquals(order, [
        "DB準備",
        "作成失敗を保存",
        "募集メッセージ削除",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs[0].failureCode,
        "ADD_RECRUITMENT_REACTIONS_FAILED",
      );
    });

    test("前回ID不明のまま補償待ちになった状況で再実行すると、操作キーからリソースを回収して逆順に削除する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        initialEvent: eventFixture({
          syncState: "CREATE_COMPENSATION_PENDING",
          lastFailureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          foundScheduledEventId: "recovered-event",
          foundRecruitmentMessageId: "recovered-message",
        }),
      );

      assertEquals(result.success, false);
      assertEquals(order, [
        "DB準備",
        "作成失敗を保存",
        "募集メッセージ検索",
        "作成失敗を保存",
        "募集メッセージ削除",
        "Discordイベント検索",
        "作成失敗を保存",
        "Discordイベント削除",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageId,
        "recovered-message",
      );
      assertEquals(
        creationFailureInputs.at(-1)?.discordScheduledEventId,
        "recovered-event",
      );
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageDeleted,
        true,
      );
      assertEquals(
        creationFailureInputs.at(-1)?.discordEventDeleted,
        true,
      );
    });

    test("補償検索で回収したIDの保存が失敗した状況では、そのDiscordリソースを削除しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: eventFixture({
          syncState: "CREATE_COMPENSATION_PENDING",
          discordEventDeleted: true,
          lastFailureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
        }),
      });
      let markCalls = 0;
      const apiWithCheckpointFailure = {
        ...api,
        markCustomGameEventCreationFailed(
          eventId: number,
          input: CreationFailureInput,
        ) {
          markCalls++;
          if (markCalls === 2) {
            order.push("回収ID保存失敗");
            return resolved({
              success: false as const,
              error: "checkpoint failed",
              code: "CONFLICT" as const,
              status: 409 as const,
            });
          }
          return api.markCustomGameEventCreationFailed(eventId, input);
        },
      } as CustomGameEventSagaApi;
      const saga = createCustomGameEventSaga(apiWithCheckpointFailure);

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          foundRecruitmentMessageId: "recovered-message",
        }),
      );

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(order, [
        "DB準備",
        "作成失敗を保存",
        "募集メッセージ検索",
        "回収ID保存失敗",
        "作成失敗を保存",
      ]);
      assertEquals(order.includes("募集メッセージ削除"), false);
      assertEquals(
        result.error.recoveryFailures.some((failure) =>
          failure.step === "RECORD_CREATION_FAILURE"
        ),
        true,
      );
    });

    test("前回ID不明の補償待ちで検索結果がない状況では、削除済みにせず補償待ちを維持する", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        initialEvent: eventFixture({
          syncState: "CREATE_COMPENSATION_PENDING",
          lastFailureCode: "CREATE_RECRUITMENT_MESSAGE_FAILED",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, false);
      assertEquals(order, [
        "DB準備",
        "作成失敗を保存",
        "募集メッセージ検索",
        "Discordイベント検索",
        "作成失敗を保存",
      ]);
      assertEquals(
        creationFailureInputs.at(-1)?.recruitmentMessageDeleted,
        false,
      );
      assertEquals(
        creationFailureInputs.at(-1)?.discordEventDeleted,
        false,
      );
    });

    test("並行処理が募集確定した後に補償claimが競合すると、Discordリソースを削除せず確定済み状態を返す", async () => {
      const order: string[] = [];
      const { api, creationFailureInputs } = fakeApi(order, {
        activateBeforeCreationFailureClaim: true,
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(
        createInput,
        fakeEffects(order, {
          failures: { "add-reactions": new Error("reaction failed") },
        }),
      );

      assertEquals(result.success, true);
      assertEquals(creationFailureInputs.length, 1);
      assertEquals(order.slice(-3), [
        "リアクション追加",
        "作成失敗を保存",
        "DB準備",
      ]);
      assertEquals(order.includes("募集メッセージ削除"), false);
      assertEquals(order.includes("Discordイベント削除"), false);
    });

    test("同じ操作キーが既に整合済みの状況で再実行すると、Discord副作用なしで成功を返す", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: eventFixture({
          discordScheduledEventId: "discord-event-1",
          recruitmentMessageId: "message-1",
          phase: "RECRUITING",
          syncState: "CONSISTENT",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.create(createInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(order, ["DB準備"]);
    });
  });

  describe("中止", () => {
    const cancelInput = {
      eventId: 113,
      guildId: "guild-1",
      recruitmentChannelId: "channel-1",
    };

    function cancellableEvent(overrides: Partial<Event> = {}) {
      return eventFixture({
        discordScheduledEventId: "discord-event-1",
        recruitmentMessageId: "message-1",
        phase: "RECRUITING",
        syncState: "CONSISTENT",
        ...overrides,
      });
    }

    test("DBへの中止開始の保存が失敗した状況で中止すると、Discord副作用を実行しない", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: cancellableEvent(),
        resultFailures: ["begin-cancellation"],
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(cancelInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error.primaryFailure.step, "BEGIN_CANCELLATION");
      assertEquals(order, ["中止開始を保存"]);
    });

    test("同一processで作成中のイベントを中止すると、作成完了を待ってから中止を開始する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order);
      const saga = createCustomGameEventSaga(api);
      let notifyScheduledCreationStarted!: () => void;
      const scheduledCreationStarted = new Promise<void>((resolve) => {
        notifyScheduledCreationStarted = resolve;
      });
      let finishScheduledCreation!: (value: { id: string }) => void;
      const scheduledCreation = new Promise<{ id: string }>((resolve) => {
        finishScheduledCreation = resolve;
      });
      const effects = {
        ...fakeEffects(order),
        createScheduledEvent(input: { operationKey: string }) {
          order.push(`Discordイベント作成:${input.operationKey}`);
          notifyScheduledCreationStarted();
          return scheduledCreation;
        },
      };

      const creating = saga.create(createInput, effects);
      await scheduledCreationStarted;
      const cancelling = saga.cancel(cancelInput, effects);
      await Promise.resolve();

      assertEquals(order.includes("中止開始を保存"), false);
      finishScheduledCreation({ id: "discord-event-1" });
      const [created, cancelled] = await Promise.all([creating, cancelling]);

      assertEquals(created.success, true);
      assertEquals(cancelled.success, true);
      assertEquals(
        order.indexOf("整合済みに更新") < order.indexOf("中止開始を保存"),
        true,
      );
    });

    test("中止開始を保存した状況で中止すると、各Discord削除の直後に進捗を保存してから成功する", async () => {
      const order: string[] = [];
      const { api, cancellationProgressInputs } = fakeApi(order, {
        initialEvent: cancellableEvent(),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(cancelInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント削除",
        "イベント削除を保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
      assertEquals(cancellationProgressInputs, [
        {
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          discordEventDeleted: true,
          failureCode: null,
        },
        {
          guildId: "guild-1",
          recruitmentChannelId: "channel-1",
          recruitmentMessageDeleted: true,
          failureCode: null,
        },
      ]);
    });

    test("Discordイベント削除が失敗した状況で中止すると、失敗コードを保存して募集メッセージを削除しない", async () => {
      const order: string[] = [];
      const { api, cancellationProgressInputs } = fakeApi(order, {
        initialEvent: cancellableEvent(),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(
        cancelInput,
        fakeEffects(order, {
          failures: { "delete-discord-event": new Error("delete failed") },
        }),
      );

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error.primaryFailure.step, "DELETE_DISCORD_EVENT");
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント削除",
        "中止失敗を保存",
      ]);
      assertEquals(
        cancellationProgressInputs[0].failureCode,
        "DELETE_DISCORD_EVENT_FAILED",
      );
    });

    test("前回Discordイベントを削除済みの状況で再実行すると、未完了の募集メッセージ削除から再開する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: cancellableEvent({
          syncState: "CANCEL_PENDING",
          discordEventDeleted: true,
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(cancelInput, fakeEffects(order));

      assertEquals(result.success, true);
      assertEquals(order, [
        "中止開始を保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
    });

    test("作成途中で外部IDが片方だけ保存された状況で中止すると、ID不明側を操作キーで照合して完了する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: eventFixture({
          discordScheduledEventId: "discord-event-1",
          phase: "PREPARING",
          syncState: "CREATE_PENDING",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(
        cancelInput,
        fakeEffects(order, {
          foundRecruitmentMessageId: "recovered-message",
        }),
      );

      assertEquals(result.success, true);
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント削除",
        "イベント削除を保存",
        "募集メッセージ検索",
        "中止メッセージID保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
    });

    test("検索で回収した募集メッセージの削除が失敗した状況で再実行すると、保存済みIDから検索せず再開する", async () => {
      const order: string[] = [];
      const { api, cancellationProgressInputs } = fakeApi(order, {
        initialEvent: eventFixture({
          phase: "PREPARING",
          syncState: "CANCEL_PENDING",
          discordEventDeleted: true,
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const first = await saga.cancel(
        cancelInput,
        fakeEffects(order, {
          foundRecruitmentMessageId: "recovered-message",
          failures: { "delete-message": new Error("delete failed") },
        }),
      );

      assertEquals(first.success, false);
      if (first.success) return;
      assertEquals(
        first.error.primaryFailure.step,
        "DELETE_RECRUITMENT_MESSAGE",
      );
      assertEquals(order, [
        "中止開始を保存",
        "募集メッセージ検索",
        "中止メッセージID保存",
        "募集メッセージ削除",
        "中止失敗を保存",
      ]);
      assertEquals(
        cancellationProgressInputs[0].recruitmentMessageId,
        "recovered-message",
      );

      order.length = 0;
      const retried = await saga.cancel(cancelInput, fakeEffects(order));

      assertEquals(retried.success, true);
      assertEquals(order, [
        "中止開始を保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
    });

    test("作成途中で外部IDが未保存かつ検索結果がない状況で中止すると、削除済みにせずCANCEL_PENDINGを維持する", async () => {
      const order: string[] = [];
      const { api, cancellationProgressInputs } = fakeApi(order, {
        initialEvent: eventFixture({
          phase: "PREPARING",
          syncState: "CREATE_PENDING",
        }),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(cancelInput, fakeEffects(order));

      assertEquals(result.success, false);
      if (result.success) return;
      assertEquals(result.error.primaryFailure.step, "FIND_DISCORD_EVENT");
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント検索",
        "中止失敗を保存",
      ]);
      assertEquals(
        cancellationProgressInputs.some((input) => input.discordEventDeleted),
        false,
      );
    });

    test("Discord側で既に削除済みと応答された状況で中止すると、削除済みとして進捗を保存する", async () => {
      const order: string[] = [];
      const { api } = fakeApi(order, {
        initialEvent: cancellableEvent(),
      });
      const saga = createCustomGameEventSaga(api);

      const result = await saga.cancel(
        cancelInput,
        fakeEffects(order, {
          failures: {
            "delete-discord-event": Object.assign(new Error("Unknown Event"), {
              code: 10_070,
            }),
            "delete-message": Object.assign(new Error("Unknown Message"), {
              code: "10008",
            }),
          },
        }),
      );

      assertEquals(result.success, true);
      assertEquals(order, [
        "中止開始を保存",
        "Discordイベント削除",
        "イベント削除を保存",
        "募集メッセージ削除",
        "メッセージ削除を保存",
      ]);
      assertEquals(isDiscordResourceAlreadyDeleted({ code: 10_070 }), true);
      assertEquals(isDiscordResourceAlreadyDeleted({ code: "10008" }), true);
      assertEquals(isDiscordResourceAlreadyDeleted({ code: 50_013 }), false);
    });
  });
});
