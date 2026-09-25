import type { Event } from "@adteemo/api/contract";
import type { EventsApiClient } from "../api_clients/events.ts";
import { failureKind, type FailureResult } from "../api_clients/transport.ts";

const UNKNOWN_MESSAGE = 10_008;
const UNKNOWN_GUILD_SCHEDULED_EVENT = 10_070;

export type CustomGameEventSagaApi = Pick<
  EventsApiClient,
  | "prepareCustomGameEvent"
  | "updateCustomGameEventCreationProgress"
  | "activateCustomGameEvent"
  | "markCustomGameEventCreationFailed"
  | "beginCustomGameEventCancellation"
  | "updateCustomGameEventCancellationProgress"
>;

export type CustomGameEventSagaStep =
  | "PREPARE_EVENT"
  | "CREATE_DISCORD_EVENT"
  | "FIND_DISCORD_EVENT_CREATION"
  | "CHECKPOINT_DISCORD_EVENT"
  | "CREATE_RECRUITMENT_MESSAGE"
  | "FIND_RECRUITMENT_MESSAGE_CREATION"
  | "CHECKPOINT_RECRUITMENT_MESSAGE"
  | "ADD_RECRUITMENT_REACTIONS"
  | "ACTIVATE_EVENT"
  | "FIND_RECRUITMENT_MESSAGE_COMPENSATION"
  | "FIND_DISCORD_EVENT_COMPENSATION"
  | "DELETE_RECRUITMENT_MESSAGE_COMPENSATION"
  | "DELETE_DISCORD_EVENT_COMPENSATION"
  | "RECORD_CREATION_FAILURE"
  | "BEGIN_CANCELLATION"
  | "FIND_DISCORD_EVENT"
  | "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET"
  | "DELETE_DISCORD_EVENT"
  | "CHECKPOINT_DISCORD_EVENT_DELETION"
  | "FIND_RECRUITMENT_MESSAGE"
  | "CHECKPOINT_RECRUITMENT_MESSAGE_CANCELLATION_TARGET"
  | "DELETE_RECRUITMENT_MESSAGE"
  | "CHECKPOINT_RECRUITMENT_MESSAGE_DELETION"
  | "RECORD_CANCELLATION_FAILURE"
  | "INVALID_STATE";

export type CustomGameEventSagaFailure = {
  step: CustomGameEventSagaStep;
  cause: unknown;
};

export class CustomGameEventSagaError extends Error {
  constructor(
    readonly primaryFailure: CustomGameEventSagaFailure,
    readonly recoveryFailures: readonly CustomGameEventSagaFailure[] = [],
  ) {
    super(`Custom game event saga failed at ${primaryFailure.step}`, {
      cause: primaryFailure.cause,
    });
    this.name = "CustomGameEventSagaError";
  }
}

export type CustomGameEventSagaResult =
  | { success: true; event: Event }
  | { success: false; error: CustomGameEventSagaError };

export type CreateCustomGameEventInput = {
  operationKey: string;
  name: string;
  guildId: string;
  creatorId: string;
  recruitmentChannelId: string;
  voiceChannelId: string;
  scheduledStartAt: Date;
  recruitmentMessageContent: string;
};

export type CreateCustomGameDiscordEffects = {
  createScheduledEvent(input: {
    operationKey: string;
    name: string;
    voiceChannelId: string;
    scheduledStartAt: Date;
  }): Promise<{ id: string }>;
  createRecruitmentMessage(input: {
    content: string;
    nonce: string;
    createdAfter: Date;
  }): Promise<{ id: string }>;
  addRecruitmentReactions(messageId: string): Promise<void>;
  findScheduledEvent(input: {
    operationKey: string;
    createdAfter: Date;
  }): Promise<{ id: string } | null>;
  findRecruitmentMessage(input: {
    operationKey: string;
    createdAfter: Date;
  }): Promise<{ id: string } | null>;
  deleteScheduledEvent(discordScheduledEventId: string): Promise<void>;
  deleteRecruitmentMessage(recruitmentMessageId: string): Promise<void>;
};

export type CancelCustomGameEventInput = {
  eventId: number;
  guildId: string;
  recruitmentChannelId: string;
};

export type CancelCustomGameDiscordEffects = {
  findScheduledEvent(input: {
    operationKey: string;
    createdAfter: Date;
  }): Promise<{ id: string } | null>;
  findRecruitmentMessage(input: {
    operationKey: string;
    createdAfter: Date;
  }): Promise<{ id: string } | null>;
  deleteScheduledEvent(discordScheduledEventId: string): Promise<void>;
  deleteRecruitmentMessage(recruitmentMessageId: string): Promise<void>;
};

class SagaStepFailure extends Error {
  constructor(
    readonly failure: CustomGameEventSagaFailure,
  ) {
    super(`Custom game event saga step failed: ${failure.step}`, {
      cause: failure.cause,
    });
    this.name = "SagaStepFailure";
  }
}

type ApiResult<T extends Record<string, unknown>> =
  | ({ success: true } & T)
  | { success: false; error: string };

const AMBIGUOUS_API_RETRY_COUNT = 1;

function isFailureResult(value: unknown): value is FailureResult {
  return typeof value === "object" && value !== null &&
    "success" in value && value.success === false &&
    "error" in value && typeof value.error === "string";
}

function isAmbiguousApiCause(cause: unknown): boolean {
  if (!isFailureResult(cause)) return true;
  if (failureKind(cause) !== "http") return true;
  return typeof cause.status !== "number" || cause.status >= 500;
}

const API_STEPS = new Set<CustomGameEventSagaStep>([
  "PREPARE_EVENT",
  "CHECKPOINT_DISCORD_EVENT",
  "CHECKPOINT_RECRUITMENT_MESSAGE",
  "ACTIVATE_EVENT",
  "RECORD_CREATION_FAILURE",
  "BEGIN_CANCELLATION",
  "CHECKPOINT_DISCORD_EVENT_DELETION",
  "CHECKPOINT_RECRUITMENT_MESSAGE_DELETION",
  "RECORD_CANCELLATION_FAILURE",
]);

function isAmbiguousApiFailure(failure: CustomGameEventSagaFailure): boolean {
  return API_STEPS.has(failure.step) && isAmbiguousApiCause(failure.cause);
}

async function apiStep<T extends Record<string, unknown>>(
  step: CustomGameEventSagaStep,
  request: () => Promise<ApiResult<T>>,
): Promise<T> {
  for (let attempt = 0; attempt <= AMBIGUOUS_API_RETRY_COUNT; attempt++) {
    try {
      const result = await request();
      if (!result.success) {
        if (
          attempt < AMBIGUOUS_API_RETRY_COUNT &&
          isAmbiguousApiCause(result)
        ) {
          continue;
        }
        throw new SagaStepFailure({ step, cause: result });
      }
      return result;
    } catch (error) {
      if (error instanceof SagaStepFailure) throw error;
      if (attempt < AMBIGUOUS_API_RETRY_COUNT) continue;
      throw new SagaStepFailure({ step, cause: error });
    }
  }
  throw new Error("Unreachable API saga retry state");
}

async function discordStep<T>(
  step: CustomGameEventSagaStep,
  effect: () => Promise<T>,
): Promise<T> {
  try {
    return await effect();
  } catch (error) {
    throw new SagaStepFailure({ step, cause: error });
  }
}

function failed(
  primaryFailure: CustomGameEventSagaFailure,
  recoveryFailures: readonly CustomGameEventSagaFailure[] = [],
): CustomGameEventSagaResult {
  return {
    success: false,
    error: new CustomGameEventSagaError(primaryFailure, recoveryFailures),
  };
}

function invalidState(event: Event): SagaStepFailure {
  return new SagaStepFailure({
    step: "INVALID_STATE",
    cause: {
      phase: event.phase,
      syncState: event.syncState,
    },
  });
}

function failureCode(step: CustomGameEventSagaStep): string {
  return `${step}_FAILED`;
}

function errorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const value = (error as { code?: unknown }).code;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function isDiscordResourceAlreadyDeleted(error: unknown): boolean {
  const code = errorCode(error);
  return code === UNKNOWN_MESSAGE || code === UNKNOWN_GUILD_SCHEDULED_EVENT;
}

function eventScope(input: {
  guildId: string;
  recruitmentChannelId: string;
}) {
  return {
    guildId: input.guildId,
    recruitmentChannelId: input.recruitmentChannelId,
  };
}

type InFlightCreate = {
  signature: string;
  result: Promise<CustomGameEventSagaResult>;
  completion: Promise<void>;
  eventIds: Set<number>;
};

type CreateResumeContext = {
  failure: CustomGameEventSagaFailure;
  discordScheduledEventId: string | null;
  recruitmentMessageId: string | null;
  mayCreateDiscordScheduledEvent: boolean;
  mayCreateRecruitmentMessage: boolean;
};

type SagaCoordinator = {
  createsByOperationKey: Map<string, InFlightCreate>;
  createCompletionByEventId: Map<number, Promise<void>>;
};

const sagaCoordinators = new WeakMap<object, SagaCoordinator>();

function coordinatorFor(api: CustomGameEventSagaApi): SagaCoordinator {
  const existing = sagaCoordinators.get(api);
  if (existing) return existing;
  const coordinator = {
    createsByOperationKey: new Map<string, InFlightCreate>(),
    createCompletionByEventId: new Map<number, Promise<void>>(),
  };
  sagaCoordinators.set(api, coordinator);
  return coordinator;
}

function createInputSignature(input: CreateCustomGameEventInput): string {
  return JSON.stringify([
    input.name,
    input.guildId,
    input.creatorId,
    input.recruitmentChannelId,
    input.voiceChannelId,
    input.scheduledStartAt.toISOString(),
    input.recruitmentMessageContent,
  ]);
}

export function createCustomGameEventSaga(api: CustomGameEventSagaApi) {
  const coordinator = coordinatorFor(api);
  async function reconcileCreationClaimState(
    state: Event,
    input: CreateCustomGameEventInput,
    effects: CreateCustomGameDiscordEffects,
    primaryFailure: CustomGameEventSagaFailure,
    unownedDiscordScheduledEventId: string | null,
    unownedRecruitmentMessageId: string | null,
    knownDiscordScheduledEventId: string | null,
    knownRecruitmentMessageId: string | null,
    unresolvedClaimFailure?: CustomGameEventSagaFailure,
  ): Promise<CustomGameEventSagaResult> {
    const recoveryFailures: CustomGameEventSagaFailure[] = [];
    const cancellationWon = state.syncState === "CANCEL_PENDING" ||
      state.phase === "CANCELLED";
    const active = state.phase === "RECRUITING" &&
      state.syncState === "CONSISTENT";

    const messageCandidates = new Set<string>();
    const discordEventCandidates = new Set<string>();
    if (cancellationWon) {
      for (
        const id of [
          unownedRecruitmentMessageId,
          knownRecruitmentMessageId,
          state.recruitmentMessageId,
        ]
      ) {
        if (id) messageCandidates.add(id);
      }
      for (
        const id of [
          unownedDiscordScheduledEventId,
          knownDiscordScheduledEventId,
          state.discordScheduledEventId,
        ]
      ) {
        if (id) discordEventCandidates.add(id);
      }
    } else {
      if (
        unownedRecruitmentMessageId &&
        unownedRecruitmentMessageId !== state.recruitmentMessageId
      ) {
        messageCandidates.add(unownedRecruitmentMessageId);
      }
      if (
        unownedDiscordScheduledEventId &&
        unownedDiscordScheduledEventId !== state.discordScheduledEventId
      ) {
        discordEventCandidates.add(unownedDiscordScheduledEventId);
      }
    }

    let messageDeletionAllowed = true;
    if (
      state.syncState === "CANCEL_PENDING" &&
      !state.recruitmentMessageId && messageCandidates.size > 0
    ) {
      if (messageCandidates.size !== 1) {
        messageDeletionAllowed = false;
        recoveryFailures.push({
          step: "CHECKPOINT_RECRUITMENT_MESSAGE_CANCELLATION_TARGET",
          cause: new Error(
            "Multiple recruitment message cancellation targets are known",
          ),
        });
      } else {
        const [targetId] = messageCandidates;
        try {
          const checkpoint = await apiStep(
            "CHECKPOINT_RECRUITMENT_MESSAGE_CANCELLATION_TARGET",
            () =>
              api.updateCustomGameEventCancellationProgress(state.id, {
                ...eventScope(input),
                recruitmentMessageId: targetId,
              }),
          );
          state = checkpoint.event;
          if (state.recruitmentMessageId !== targetId) {
            messageDeletionAllowed = false;
            recoveryFailures.push({
              step: "CHECKPOINT_RECRUITMENT_MESSAGE_CANCELLATION_TARGET",
              cause: new Error(
                "Recruitment message cancellation target was not checkpointed",
              ),
            });
          }
        } catch (error) {
          messageDeletionAllowed = false;
          recoveryFailures.push((error as SagaStepFailure).failure);
        }
      }
    }

    let messagesDeleted = messageCandidates.size > 0 &&
      messageDeletionAllowed;
    if (messageDeletionAllowed) {
      for (const id of messageCandidates) {
        try {
          await effects.deleteRecruitmentMessage(id);
        } catch (error) {
          if (!isDiscordResourceAlreadyDeleted(error)) {
            messagesDeleted = false;
            recoveryFailures.push({
              step: "DELETE_RECRUITMENT_MESSAGE_COMPENSATION",
              cause: error,
            });
          }
        }
      }
    }

    let discordEventDeletionAllowed = true;
    if (
      state.syncState === "CANCEL_PENDING" &&
      !state.discordScheduledEventId && discordEventCandidates.size > 0
    ) {
      if (discordEventCandidates.size !== 1) {
        discordEventDeletionAllowed = false;
        recoveryFailures.push({
          step: "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET",
          cause: new Error(
            "Multiple Discord event cancellation targets are known",
          ),
        });
      } else {
        const [targetId] = discordEventCandidates;
        try {
          const checkpoint = await apiStep(
            "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET",
            () =>
              api.updateCustomGameEventCancellationProgress(state.id, {
                ...eventScope(input),
                discordScheduledEventId: targetId,
              }),
          );
          state = checkpoint.event;
          if (state.discordScheduledEventId !== targetId) {
            discordEventDeletionAllowed = false;
            recoveryFailures.push({
              step: "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET",
              cause: new Error(
                "Discord event cancellation target was not checkpointed",
              ),
            });
          }
        } catch (error) {
          discordEventDeletionAllowed = false;
          recoveryFailures.push((error as SagaStepFailure).failure);
        }
      }
    }

    let discordEventsDeleted = discordEventCandidates.size > 0 &&
      discordEventDeletionAllowed;
    if (discordEventDeletionAllowed) {
      for (const id of discordEventCandidates) {
        try {
          await effects.deleteScheduledEvent(id);
        } catch (error) {
          if (!isDiscordResourceAlreadyDeleted(error)) {
            discordEventsDeleted = false;
            recoveryFailures.push({
              step: "DELETE_DISCORD_EVENT_COMPENSATION",
              cause: error,
            });
          }
        }
      }
    }

    if (state.syncState === "CANCEL_PENDING") {
      if (messagesDeleted) {
        try {
          const checkpoint = await apiStep(
            "CHECKPOINT_RECRUITMENT_MESSAGE_DELETION",
            () =>
              api.updateCustomGameEventCancellationProgress(state.id, {
                ...eventScope(input),
                recruitmentMessageDeleted: true,
                failureCode: null,
              }),
          );
          state = checkpoint.event;
        } catch (error) {
          recoveryFailures.push((error as SagaStepFailure).failure);
        }
      }
      if (discordEventsDeleted && state.syncState === "CANCEL_PENDING") {
        try {
          const checkpoint = await apiStep(
            "CHECKPOINT_DISCORD_EVENT_DELETION",
            () =>
              api.updateCustomGameEventCancellationProgress(state.id, {
                ...eventScope(input),
                discordEventDeleted: true,
                failureCode: null,
              }),
          );
          state = checkpoint.event;
        } catch (error) {
          recoveryFailures.push((error as SagaStepFailure).failure);
        }
      }
    }

    if (recoveryFailures.length > 0) {
      return failed(primaryFailure, recoveryFailures);
    }
    if (active) return { success: true, event: state };
    if (unresolvedClaimFailure) {
      return failed(primaryFailure, [unresolvedClaimFailure]);
    }
    return failed(primaryFailure);
  }

  async function recordCreationFailure(
    event: Event,
    input: CreateCustomGameEventInput,
    effects: CreateCustomGameDiscordEffects,
    primaryFailure: CustomGameEventSagaFailure,
    initialDiscordScheduledEventId = event.discordScheduledEventId,
    initialRecruitmentMessageId = event.recruitmentMessageId,
    unownedDiscordScheduledEventId: string | null = null,
    unownedRecruitmentMessageId: string | null = null,
  ): Promise<CustomGameEventSagaResult> {
    const recoveryFailures: CustomGameEventSagaFailure[] = [];
    const recordedFailureCode = primaryFailure.step === "INVALID_STATE" &&
        event.lastFailureCode
      ? event.lastFailureCode
      : failureCode(primaryFailure.step);
    let compensationEvent: Event;

    try {
      const claimed = await apiStep(
        "RECORD_CREATION_FAILURE",
        () =>
          api.markCustomGameEventCreationFailed(event.id, {
            ...eventScope(input),
            ...(initialDiscordScheduledEventId
              ? { discordScheduledEventId: initialDiscordScheduledEventId }
              : {}),
            ...(initialRecruitmentMessageId
              ? { recruitmentMessageId: initialRecruitmentMessageId }
              : {}),
            discordEventDeleted: event.discordEventDeleted,
            recruitmentMessageDeleted: event.recruitmentMessageDeleted,
            failureCode: recordedFailureCode,
          }),
      );
      compensationEvent = claimed.event;
    } catch (error) {
      const claimFailure = (error as SagaStepFailure).failure;
      try {
        const prepared = await apiStep(
          "PREPARE_EVENT",
          () =>
            api.prepareCustomGameEvent({
              operationKey: input.operationKey,
              name: input.name,
              guildId: input.guildId,
              creatorId: input.creatorId,
              recruitmentChannelId: input.recruitmentChannelId,
              voiceChannelId: input.voiceChannelId,
              scheduledStartAt: input.scheduledStartAt,
            }),
        );
        compensationEvent = prepared.event;
      } catch (reconcileError) {
        return failed(primaryFailure, [
          claimFailure,
          (reconcileError as SagaStepFailure).failure,
        ]);
      }

      if (
        compensationEvent.phase === "RECRUITING" &&
        compensationEvent.syncState === "CONSISTENT"
      ) {
        return await reconcileCreationClaimState(
          compensationEvent,
          input,
          effects,
          primaryFailure,
          unownedDiscordScheduledEventId,
          unownedRecruitmentMessageId,
          initialDiscordScheduledEventId,
          initialRecruitmentMessageId,
        );
      }
      if (
        compensationEvent.phase === "CANCELLED" &&
        compensationEvent.syncState === "CONSISTENT"
      ) {
        return await reconcileCreationClaimState(
          compensationEvent,
          input,
          effects,
          primaryFailure,
          unownedDiscordScheduledEventId,
          unownedRecruitmentMessageId,
          initialDiscordScheduledEventId,
          initialRecruitmentMessageId,
        );
      }
      if (compensationEvent.syncState !== "CREATE_COMPENSATION_PENDING") {
        return await reconcileCreationClaimState(
          compensationEvent,
          input,
          effects,
          primaryFailure,
          unownedDiscordScheduledEventId,
          unownedRecruitmentMessageId,
          initialDiscordScheduledEventId,
          initialRecruitmentMessageId,
          claimFailure,
        );
      }
      if (
        (unownedDiscordScheduledEventId &&
          unownedDiscordScheduledEventId !==
            compensationEvent.discordScheduledEventId) ||
        (unownedRecruitmentMessageId &&
          unownedRecruitmentMessageId !==
            compensationEvent.recruitmentMessageId)
      ) {
        return await reconcileCreationClaimState(
          compensationEvent,
          input,
          effects,
          primaryFailure,
          unownedDiscordScheduledEventId,
          unownedRecruitmentMessageId,
          initialDiscordScheduledEventId,
          initialRecruitmentMessageId,
          claimFailure,
        );
      }
    }

    if (
      compensationEvent.phase === "CANCELLED" &&
      compensationEvent.syncState === "CONSISTENT"
    ) {
      return await reconcileCreationClaimState(
        compensationEvent,
        input,
        effects,
        primaryFailure,
        unownedDiscordScheduledEventId,
        unownedRecruitmentMessageId,
        initialDiscordScheduledEventId,
        initialRecruitmentMessageId,
      );
    }
    if (compensationEvent.syncState !== "CREATE_COMPENSATION_PENDING") {
      return failed(primaryFailure, [{
        step: "RECORD_CREATION_FAILURE",
        cause: {
          phase: compensationEvent.phase,
          syncState: compensationEvent.syncState,
        },
      }]);
    }

    event = compensationEvent;
    let discordScheduledEventId = initialDiscordScheduledEventId;
    let recruitmentMessageId = initialRecruitmentMessageId;
    discordScheduledEventId ??= event.discordScheduledEventId;
    recruitmentMessageId ??= event.recruitmentMessageId;
    let discordEventDeleted = compensationEvent.discordEventDeleted;
    let recruitmentMessageDeleted = compensationEvent.recruitmentMessageDeleted;
    let discordScheduledEventTargetCheckpointed =
      discordScheduledEventId !== null &&
      event.discordScheduledEventId === discordScheduledEventId;
    let recruitmentMessageTargetCheckpointed = recruitmentMessageId !== null &&
      event.recruitmentMessageId === recruitmentMessageId;
    const recruitmentMessageCreationWasNotStarted =
      primaryFailure.step === "CREATE_DISCORD_EVENT" ||
      primaryFailure.step === "CHECKPOINT_DISCORD_EVENT";

    if (!recruitmentMessageId && !recruitmentMessageDeleted) {
      try {
        const found = await effects.findRecruitmentMessage({
          operationKey: input.operationKey,
          createdAfter: event.createdAt,
        });
        if (found) {
          recruitmentMessageId = found.id;
          try {
            const checkpoint = await apiStep(
              "RECORD_CREATION_FAILURE",
              () =>
                api.markCustomGameEventCreationFailed(event.id, {
                  ...eventScope(input),
                  ...(discordScheduledEventId
                    ? { discordScheduledEventId }
                    : {}),
                  recruitmentMessageId: found.id,
                  discordEventDeleted,
                  recruitmentMessageDeleted,
                  failureCode: recordedFailureCode,
                }),
            );
            event = checkpoint.event;
            recruitmentMessageTargetCheckpointed =
              event.syncState === "CREATE_COMPENSATION_PENDING" &&
              event.recruitmentMessageId === found.id;
            if (!recruitmentMessageTargetCheckpointed) {
              recoveryFailures.push({
                step: "RECORD_CREATION_FAILURE",
                cause: new Error(
                  "Recovered recruitment message target was not checkpointed",
                ),
              });
            }
          } catch (error) {
            recoveryFailures.push((error as SagaStepFailure).failure);
          }
        } else if (recruitmentMessageCreationWasNotStarted) {
          recruitmentMessageDeleted = true;
        } else {
          recoveryFailures.push({
            step: "FIND_RECRUITMENT_MESSAGE_COMPENSATION",
            cause: new Error(
              "Recruitment message absence cannot be confirmed yet",
            ),
          });
        }
      } catch (error) {
        recoveryFailures.push({
          step: "FIND_RECRUITMENT_MESSAGE_COMPENSATION",
          cause: error,
        });
      }
    }

    if (
      recruitmentMessageId && !recruitmentMessageDeleted &&
      recruitmentMessageTargetCheckpointed
    ) {
      try {
        await effects.deleteRecruitmentMessage(recruitmentMessageId);
        recruitmentMessageDeleted = true;
      } catch (error) {
        if (isDiscordResourceAlreadyDeleted(error)) {
          recruitmentMessageDeleted = true;
        } else {
          recoveryFailures.push({
            step: "DELETE_RECRUITMENT_MESSAGE_COMPENSATION",
            cause: error,
          });
        }
      }
    }

    if (!discordScheduledEventId && !discordEventDeleted) {
      try {
        const found = await effects.findScheduledEvent({
          operationKey: input.operationKey,
          createdAfter: event.createdAt,
        });
        if (found) {
          discordScheduledEventId = found.id;
          try {
            const checkpoint = await apiStep(
              "RECORD_CREATION_FAILURE",
              () =>
                api.markCustomGameEventCreationFailed(event.id, {
                  ...eventScope(input),
                  discordScheduledEventId: found.id,
                  ...(recruitmentMessageId ? { recruitmentMessageId } : {}),
                  discordEventDeleted,
                  recruitmentMessageDeleted,
                  failureCode: recordedFailureCode,
                }),
            );
            event = checkpoint.event;
            discordScheduledEventTargetCheckpointed =
              event.syncState === "CREATE_COMPENSATION_PENDING" &&
              event.discordScheduledEventId === found.id;
            if (!discordScheduledEventTargetCheckpointed) {
              recoveryFailures.push({
                step: "RECORD_CREATION_FAILURE",
                cause: new Error(
                  "Recovered Discord event target was not checkpointed",
                ),
              });
            }
          } catch (error) {
            recoveryFailures.push((error as SagaStepFailure).failure);
          }
        } else {
          recoveryFailures.push({
            step: "FIND_DISCORD_EVENT_COMPENSATION",
            cause: new Error(
              "Discord scheduled event absence cannot be confirmed yet",
            ),
          });
        }
      } catch (error) {
        recoveryFailures.push({
          step: "FIND_DISCORD_EVENT_COMPENSATION",
          cause: error,
        });
      }
    }

    if (
      discordScheduledEventId && !discordEventDeleted &&
      discordScheduledEventTargetCheckpointed
    ) {
      try {
        await effects.deleteScheduledEvent(discordScheduledEventId);
        discordEventDeleted = true;
      } catch (error) {
        if (isDiscordResourceAlreadyDeleted(error)) {
          discordEventDeleted = true;
        } else {
          recoveryFailures.push({
            step: "DELETE_DISCORD_EVENT_COMPENSATION",
            cause: error,
          });
        }
      }
    }

    try {
      await apiStep(
        "RECORD_CREATION_FAILURE",
        () =>
          api.markCustomGameEventCreationFailed(event.id, {
            ...eventScope(input),
            ...(discordScheduledEventId ? { discordScheduledEventId } : {}),
            ...(recruitmentMessageId ? { recruitmentMessageId } : {}),
            discordEventDeleted,
            recruitmentMessageDeleted,
            failureCode: recordedFailureCode,
          }),
      );
    } catch (error) {
      const stepFailure = error as SagaStepFailure;
      recoveryFailures.push(stepFailure.failure);
    }

    return failed(primaryFailure, recoveryFailures);
  }

  async function createAttempt(
    input: CreateCustomGameEventInput,
    effects: CreateCustomGameDiscordEffects,
    reconcileAmbiguousFailure: boolean,
    inFlightCreate: InFlightCreate,
    resume: CreateResumeContext | null = null,
  ): Promise<CustomGameEventSagaResult> {
    let event: Event;
    let preparedCreated: boolean;
    try {
      const prepared = await apiStep(
        "PREPARE_EVENT",
        () =>
          api.prepareCustomGameEvent({
            operationKey: input.operationKey,
            name: input.name,
            guildId: input.guildId,
            creatorId: input.creatorId,
            recruitmentChannelId: input.recruitmentChannelId,
            voiceChannelId: input.voiceChannelId,
            scheduledStartAt: input.scheduledStartAt,
          }),
      );
      event = prepared.event;
      preparedCreated = prepared.created;
      inFlightCreate.eventIds.add(event.id);
      coordinator.createCompletionByEventId.set(
        event.id,
        inFlightCreate.completion,
      );
    } catch (error) {
      const primaryFailure = (error as SagaStepFailure).failure;
      if (
        reconcileAmbiguousFailure && isAmbiguousApiFailure(primaryFailure)
      ) {
        return await createAttempt(input, effects, false, inFlightCreate, {
          failure: primaryFailure,
          discordScheduledEventId: null,
          recruitmentMessageId: null,
          mayCreateDiscordScheduledEvent: true,
          mayCreateRecruitmentMessage: true,
        });
      }
      return failed(primaryFailure);
    }

    const resumeDiscordScheduledEventId = resume?.discordScheduledEventId ??
      null;
    const resumeRecruitmentMessageId = resume?.recruitmentMessageId ?? null;
    const unownedResumeDiscordScheduledEventId =
      resumeDiscordScheduledEventId &&
        resumeDiscordScheduledEventId !== event.discordScheduledEventId
        ? resumeDiscordScheduledEventId
        : null;
    const unownedResumeRecruitmentMessageId = resumeRecruitmentMessageId &&
        resumeRecruitmentMessageId !== event.recruitmentMessageId
      ? resumeRecruitmentMessageId
      : null;

    if (
      resume &&
      ((event.discordScheduledEventId &&
        unownedResumeDiscordScheduledEventId) ||
        (event.recruitmentMessageId &&
          unownedResumeRecruitmentMessageId))
    ) {
      return await reconcileCreationClaimState(
        event,
        input,
        effects,
        resume.failure,
        unownedResumeDiscordScheduledEventId,
        unownedResumeRecruitmentMessageId,
        resumeDiscordScheduledEventId,
        resumeRecruitmentMessageId,
      );
    }

    if (event.syncState === "CREATE_COMPENSATION_PENDING") {
      return await recordCreationFailure(
        event,
        input,
        effects,
        resume?.failure ?? {
          step: "INVALID_STATE",
          cause: { lastFailureCode: event.lastFailureCode },
        },
        resumeDiscordScheduledEventId,
        resumeRecruitmentMessageId,
        unownedResumeDiscordScheduledEventId,
        unownedResumeRecruitmentMessageId,
      );
    }

    if (resume && event.syncState !== "CREATE_PENDING") {
      return await reconcileCreationClaimState(
        event,
        input,
        effects,
        resume.failure,
        unownedResumeDiscordScheduledEventId,
        unownedResumeRecruitmentMessageId,
        resumeDiscordScheduledEventId,
        resumeRecruitmentMessageId,
      );
    }

    if (event.phase === "RECRUITING" && event.syncState === "CONSISTENT") {
      return { success: true, event };
    }

    if (event.phase === "CANCELLED" || event.syncState !== "CREATE_PENDING") {
      return failed(invalidState(event).failure);
    }

    let discordScheduledEventId = event.discordScheduledEventId ??
      resumeDiscordScheduledEventId;
    let recruitmentMessageId = event.recruitmentMessageId ??
      resumeRecruitmentMessageId;
    let unownedDiscordScheduledEventId = event.discordScheduledEventId === null
      ? resumeDiscordScheduledEventId
      : null;
    let unownedRecruitmentMessageId = event.recruitmentMessageId === null
      ? resumeRecruitmentMessageId
      : null;
    const mayCreateDiscordScheduledEvent = preparedCreated ||
      resume?.mayCreateDiscordScheduledEvent === true;
    const mayCreateRecruitmentMessage = preparedCreated ||
      resume?.mayCreateRecruitmentMessage === true;

    try {
      if (!event.discordScheduledEventId) {
        if (!discordScheduledEventId && !mayCreateDiscordScheduledEvent) {
          let found: { id: string } | null;
          try {
            found = await discordStep(
              "FIND_DISCORD_EVENT_CREATION",
              () =>
                effects.findScheduledEvent({
                  operationKey: input.operationKey,
                  createdAfter: event.createdAt,
                }),
            );
          } catch (error) {
            return failed((error as SagaStepFailure).failure);
          }
          if (!found) {
            return failed({
              step: "FIND_DISCORD_EVENT_CREATION",
              cause: new Error(
                "Discord scheduled event absence cannot be confirmed yet",
              ),
            });
          }
          discordScheduledEventId = found.id;
          unownedDiscordScheduledEventId = found.id;
        }
        if (!discordScheduledEventId) {
          const discordEvent = await discordStep(
            "CREATE_DISCORD_EVENT",
            () =>
              effects.createScheduledEvent({
                operationKey: input.operationKey,
                name: input.name,
                voiceChannelId: input.voiceChannelId,
                scheduledStartAt: input.scheduledStartAt,
              }),
          );
          discordScheduledEventId = discordEvent.id;
          unownedDiscordScheduledEventId = discordEvent.id;
        }
        const checkpointDiscordScheduledEventId = discordScheduledEventId;
        const checkpoint = await apiStep(
          "CHECKPOINT_DISCORD_EVENT",
          () =>
            api.updateCustomGameEventCreationProgress(event.id, {
              ...eventScope(input),
              discordScheduledEventId: checkpointDiscordScheduledEventId,
            }),
        );
        event = checkpoint.event;
        unownedDiscordScheduledEventId = null;
      }

      if (!event.recruitmentMessageId) {
        if (!recruitmentMessageId && !mayCreateRecruitmentMessage) {
          let found: { id: string } | null;
          try {
            found = await discordStep(
              "FIND_RECRUITMENT_MESSAGE_CREATION",
              () =>
                effects.findRecruitmentMessage({
                  operationKey: input.operationKey,
                  createdAfter: event.createdAt,
                }),
            );
          } catch (error) {
            return failed((error as SagaStepFailure).failure);
          }
          if (!found) {
            return failed({
              step: "FIND_RECRUITMENT_MESSAGE_CREATION",
              cause: new Error(
                "Recruitment message absence cannot be confirmed yet",
              ),
            });
          }
          recruitmentMessageId = found.id;
          unownedRecruitmentMessageId = found.id;
        }
        if (!recruitmentMessageId) {
          const message = await discordStep(
            "CREATE_RECRUITMENT_MESSAGE",
            () =>
              effects.createRecruitmentMessage({
                content: input.recruitmentMessageContent,
                nonce: input.operationKey,
                createdAfter: event.createdAt,
              }),
          );
          recruitmentMessageId = message.id;
          unownedRecruitmentMessageId = message.id;
        }
        const checkpointRecruitmentMessageId = recruitmentMessageId;
        const checkpoint = await apiStep(
          "CHECKPOINT_RECRUITMENT_MESSAGE",
          () =>
            api.updateCustomGameEventCreationProgress(event.id, {
              ...eventScope(input),
              recruitmentMessageId: checkpointRecruitmentMessageId,
            }),
        );
        event = checkpoint.event;
        unownedRecruitmentMessageId = null;
      }

      await discordStep(
        "ADD_RECRUITMENT_REACTIONS",
        () => effects.addRecruitmentReactions(recruitmentMessageId!),
      );

      const activated = await apiStep(
        "ACTIVATE_EVENT",
        () => api.activateCustomGameEvent(event.id, eventScope(input)),
      );
      event = activated.event;
      if (event.phase !== "RECRUITING" || event.syncState !== "CONSISTENT") {
        throw new SagaStepFailure({
          step: "ACTIVATE_EVENT",
          cause: {
            reason: "Activation response did not reach a consistent state",
            phase: event.phase,
            syncState: event.syncState,
          },
        });
      }
      return { success: true, event };
    } catch (error) {
      const primaryFailure = (error as SagaStepFailure).failure;
      if (isAmbiguousApiFailure(primaryFailure)) {
        if (reconcileAmbiguousFailure) {
          return await createAttempt(input, effects, false, inFlightCreate, {
            failure: primaryFailure,
            discordScheduledEventId,
            recruitmentMessageId,
            mayCreateDiscordScheduledEvent: discordScheduledEventId === null,
            mayCreateRecruitmentMessage: recruitmentMessageId === null,
          });
        }
        return failed(primaryFailure);
      }
      return await recordCreationFailure(
        event,
        input,
        effects,
        primaryFailure,
        discordScheduledEventId,
        recruitmentMessageId,
        unownedDiscordScheduledEventId,
        unownedRecruitmentMessageId,
      );
    }
  }

  async function create(
    input: CreateCustomGameEventInput,
    effects: CreateCustomGameDiscordEffects,
  ): Promise<CustomGameEventSagaResult> {
    const signature = createInputSignature(input);
    const existing = coordinator.createsByOperationKey.get(input.operationKey);
    if (existing) {
      if (existing.signature === signature) return await existing.result;
      await existing.completion;
      return await create(input, effects);
    }

    let resolveResult!: (result: CustomGameEventSagaResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<CustomGameEventSagaResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const inFlightCreate: InFlightCreate = {
      signature,
      result,
      completion,
      eventIds: new Set(),
    };
    coordinator.createsByOperationKey.set(input.operationKey, inFlightCreate);

    void (async () => {
      try {
        resolveResult(
          await createAttempt(input, effects, true, inFlightCreate),
        );
      } catch (error) {
        rejectResult(error);
      } finally {
        if (
          coordinator.createsByOperationKey.get(input.operationKey) ===
            inFlightCreate
        ) {
          coordinator.createsByOperationKey.delete(input.operationKey);
        }
        for (const eventId of inFlightCreate.eventIds) {
          if (
            coordinator.createCompletionByEventId.get(eventId) === completion
          ) {
            coordinator.createCompletionByEventId.delete(eventId);
          }
        }
        resolveCompletion();
      }
    })();

    return await result;
  }

  async function recordCancellationFailure(
    eventId: number,
    input: CancelCustomGameEventInput,
    primaryFailure: CustomGameEventSagaFailure,
  ): Promise<CustomGameEventSagaResult> {
    const recoveryFailures: CustomGameEventSagaFailure[] = [];
    try {
      await apiStep(
        "RECORD_CANCELLATION_FAILURE",
        () =>
          api.updateCustomGameEventCancellationProgress(eventId, {
            ...eventScope(input),
            failureCode: failureCode(primaryFailure.step),
          }),
      );
    } catch (error) {
      recoveryFailures.push((error as SagaStepFailure).failure);
    }
    return failed(primaryFailure, recoveryFailures);
  }

  async function cancel(
    input: CancelCustomGameEventInput,
    effects: CancelCustomGameDiscordEffects,
  ): Promise<CustomGameEventSagaResult> {
    const inFlightCreate = coordinator.createCompletionByEventId.get(
      input.eventId,
    );
    if (inFlightCreate) await inFlightCreate;

    let event: Event;
    try {
      const begun = await apiStep(
        "BEGIN_CANCELLATION",
        () =>
          api.beginCustomGameEventCancellation(
            input.eventId,
            eventScope(input),
          ),
      );
      event = begun.event;
    } catch (error) {
      return failed((error as SagaStepFailure).failure);
    }

    if (event.phase === "CANCELLED" && event.syncState === "CONSISTENT") {
      return { success: true, event };
    }
    if (event.syncState !== "CANCEL_PENDING") {
      return failed(invalidState(event).failure);
    }

    if (!event.discordEventDeleted) {
      let discordScheduledEventId = event.discordScheduledEventId;
      if (!discordScheduledEventId) {
        if (!event.operationKey) {
          return await recordCancellationFailure(event.id, input, {
            step: "FIND_DISCORD_EVENT",
            cause: new Error("Event operation key is unavailable"),
          });
        }
        try {
          const found = await discordStep(
            "FIND_DISCORD_EVENT",
            () =>
              effects.findScheduledEvent({
                operationKey: event.operationKey!,
                createdAfter: event.createdAt,
              }),
          );
          if (!found) {
            return await recordCancellationFailure(event.id, input, {
              step: "FIND_DISCORD_EVENT",
              cause: new Error(
                "Discord scheduled event absence cannot be confirmed yet",
              ),
            });
          }
          discordScheduledEventId = found.id;
          const checkpoint = await apiStep(
            "CHECKPOINT_DISCORD_EVENT_CANCELLATION_TARGET",
            () =>
              api.updateCustomGameEventCancellationProgress(event.id, {
                ...eventScope(input),
                discordScheduledEventId: found.id,
              }),
          );
          event = checkpoint.event;
        } catch (error) {
          const failure = error instanceof SagaStepFailure ? error.failure : {
            step: "FIND_DISCORD_EVENT" as const,
            cause: error,
          };
          return await recordCancellationFailure(
            event.id,
            input,
            failure,
          );
        }
      }
      if (discordScheduledEventId) {
        try {
          await effects.deleteScheduledEvent(discordScheduledEventId);
        } catch (error) {
          if (!isDiscordResourceAlreadyDeleted(error)) {
            return await recordCancellationFailure(event.id, input, {
              step: "DELETE_DISCORD_EVENT",
              cause: error,
            });
          }
        }
      }

      try {
        const checkpoint = await apiStep(
          "CHECKPOINT_DISCORD_EVENT_DELETION",
          () =>
            api.updateCustomGameEventCancellationProgress(event.id, {
              ...eventScope(input),
              discordEventDeleted: true,
              failureCode: null,
            }),
        );
        event = checkpoint.event;
      } catch (error) {
        return failed((error as SagaStepFailure).failure);
      }
    }

    if (!event.recruitmentMessageDeleted) {
      let recruitmentMessageId = event.recruitmentMessageId;
      if (!recruitmentMessageId) {
        if (!event.operationKey) {
          return await recordCancellationFailure(event.id, input, {
            step: "FIND_RECRUITMENT_MESSAGE",
            cause: new Error("Event operation key is unavailable"),
          });
        }
        try {
          const found = await discordStep(
            "FIND_RECRUITMENT_MESSAGE",
            () =>
              effects.findRecruitmentMessage({
                operationKey: event.operationKey!,
                createdAfter: event.createdAt,
              }),
          );
          if (!found) {
            return await recordCancellationFailure(event.id, input, {
              step: "FIND_RECRUITMENT_MESSAGE",
              cause: new Error(
                "Recruitment message absence cannot be confirmed yet",
              ),
            });
          }
          recruitmentMessageId = found.id;
          const checkpoint = await apiStep(
            "CHECKPOINT_RECRUITMENT_MESSAGE_CANCELLATION_TARGET",
            () =>
              api.updateCustomGameEventCancellationProgress(event.id, {
                ...eventScope(input),
                recruitmentMessageId: found.id,
              }),
          );
          event = checkpoint.event;
        } catch (error) {
          const failure = error instanceof SagaStepFailure ? error.failure : {
            step: "FIND_RECRUITMENT_MESSAGE" as const,
            cause: error,
          };
          return await recordCancellationFailure(
            event.id,
            input,
            failure,
          );
        }
      }
      if (recruitmentMessageId) {
        try {
          await effects.deleteRecruitmentMessage(recruitmentMessageId);
        } catch (error) {
          if (!isDiscordResourceAlreadyDeleted(error)) {
            return await recordCancellationFailure(event.id, input, {
              step: "DELETE_RECRUITMENT_MESSAGE",
              cause: error,
            });
          }
        }
      }

      try {
        const checkpoint = await apiStep(
          "CHECKPOINT_RECRUITMENT_MESSAGE_DELETION",
          () =>
            api.updateCustomGameEventCancellationProgress(event.id, {
              ...eventScope(input),
              recruitmentMessageDeleted: true,
              failureCode: null,
            }),
        );
        event = checkpoint.event;
      } catch (error) {
        return failed((error as SagaStepFailure).failure);
      }
    }

    if (event.phase !== "CANCELLED" || event.syncState !== "CONSISTENT") {
      return failed(invalidState(event).failure);
    }
    return { success: true, event };
  }

  return { create, cancel };
}

export type CustomGameEventSaga = ReturnType<typeof createCustomGameEventSaga>;
