import { assertEquals } from "@std/assert";
import { EmbedBuilder } from "discord.js";
import type { MatchWatcher, RiotAccount } from "@adteemo/api/contract";
import {
  createMatchTrackingService,
  type MatchTrackingServiceDependencies as Deps,
} from "../match_tracking_service.ts";
import { account, trackingNow } from "./match_tracking_fixtures.ts";
import { strictFake } from "./strict_fake.ts";

type Active = Awaited<
  ReturnType<Deps["apiClient"]["inspectMatchWatcherActiveGame"]>
>;
type Result = Awaited<
  ReturnType<Deps["apiClient"]["inspectMatchWatcherResult"]>
>;
type Notification = Deps["notifier"]["sendOrEditWatcherMessage"];

export function trackingServiceHarness(input: {
  watchers: MatchWatcher[];
  accounts?: RiotAccount[];
  active?: Array<{ guildId?: string; targetDiscordId: string; result: Active }>;
  results?: Array<{ targetDiscordId: string; result: Result }>;
  notifications?: Array<
    {
      messageId: string | null;
      resultId: string;
      intent?: string;
      failure?: Awaited<ReturnType<Notification>>;
    }
  >;
}) {
  const scope = new DisposableStack();
  const states: Parameters<Deps["apiClient"]["updateMatchWatcherState"]>[] = [];
  const renderedActive: Parameters<Deps["renderer"]["activeGame"]>[] = [];
  const renderedResults: Parameters<Deps["renderer"]["matchResult"]>[] = [];
  const errors: Parameters<Deps["logger"]["error"]>[] = [];
  const warnings: Parameters<Deps["logger"]["warn"]>[] = [];
  const gets = scope.use(
    strictFake<
      Parameters<Deps["apiClient"]["getRiotAccount"]>,
      ReturnType<Deps["apiClient"]["getRiotAccount"]>
    >(
      "getRiotAccount",
      (input.accounts ?? []).map((value) => ({
        args: [value.discordId, value.puuid],
        value: Promise.resolve({ success: true, account: value }),
      })),
    ),
  );
  const active = scope.use(
    strictFake<
      Parameters<Deps["apiClient"]["inspectMatchWatcherActiveGame"]>,
      ReturnType<Deps["apiClient"]["inspectMatchWatcherActiveGame"]>
    >(
      "inspectActive",
      (input.active ?? []).map((step) => ({
        check: (guild, target) => {
          assertEquals(guild, step.guildId ?? "guild-1");
          assertEquals(target, step.targetDiscordId);
        },
        value: Promise.resolve(step.result),
      })),
    ),
  );
  const results = scope.use(
    strictFake<
      Parameters<Deps["apiClient"]["inspectMatchWatcherResult"]>,
      ReturnType<Deps["apiClient"]["inspectMatchWatcherResult"]>
    >(
      "inspectResult",
      (input.results ?? []).map((step) => ({
        check: (_guild, target) => assertEquals(target, step.targetDiscordId),
        value: Promise.resolve(step.result),
      })),
    ),
  );
  const notifications = scope.use(
    strictFake<Parameters<Notification>, ReturnType<Notification>>(
      "notify",
      (input.notifications ?? []).map((step) => ({
        check: (_watcher, messageId, _embed, intent) => {
          assertEquals(messageId, step.messageId);
          if (step.intent) assertEquals(intent, step.intent);
        },
        value: Promise.resolve(
          step.failure ?? {
            status: step.messageId ? "edited" : "sent",
            messageId: step.resultId,
          },
        ),
      })),
    ),
  );
  const service = createMatchTrackingService({
    apiClient: {
      getEnabledMatchWatchers: () =>
        Promise.resolve({ success: true, watchers: input.watchers }),
      getRiotAccount: gets.invoke,
      inspectMatchWatcherActiveGame: active.invoke,
      inspectMatchWatcherResult: results.invoke,
      updateMatchWatcherState: (...args) => {
        states.push(args);
        return Promise.resolve({ success: true });
      },
    },
    notifier: { sendOrEditWatcherMessage: notifications.invoke },
    renderer: {
      activeGame: (...args) => {
        renderedActive.push(args);
        return Promise.resolve(new EmbedBuilder().setTitle("active"));
      },
      resultPending: () => new EmbedBuilder().setTitle("pending"),
      resultFetchTimeout: () => new EmbedBuilder().setTitle("timeout"),
      matchResult: (...args) => {
        renderedResults.push(args);
        return Promise.resolve(new EmbedBuilder().setTitle("result"));
      },
    },
    clock: { now: () => trackingNow },
    logger: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
    },
    config: {
      pollIntervalMs: 60_000,
      inGameNotifyIntervalMs: 300_000,
      resultFetchTimeoutMs: 10_800_000,
      riotLongWindowLimit: 100,
      riotLongWindowMs: 120_000,
    },
  });
  return {
    service,
    states,
    activeInspections: active.calls,
    notifications: notifications.calls,
    renderedActive,
    renderedResults,
    errors,
    warnings,
    [Symbol.dispose]() {
      scope.dispose();
    },
  };
}

export function activeInspection(
  game: Extract<Active, { success: true }>["activeGame"],
  targetAccount = account(),
): Active {
  return {
    success: true,
    account: targetAccount,
    activeGame: game,
    notificationIntent: null,
    stateTransition: null,
  };
}
export function resultInspection(
  match: Extract<Result, { success: true }>["match"],
  targetAccount = account(),
): Result {
  return {
    success: true,
    account: targetAccount,
    match,
    rankSummary: null,
    opggDetail: null,
    notificationIntent: null,
    stateTransition: null,
  };
}
