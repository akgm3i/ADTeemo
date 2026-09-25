import { EmbedBuilder } from "discord.js";
import type { MatchWatcher, NotificationDelivery } from "@adteemo/api/contract";
import type { ApiClient } from "../api_client.ts";
import type {
  DeliveryAttempt,
  NotificationResult,
} from "./match_tracking_notifier.ts";

export type NotificationDeliveryStore = Pick<
  ApiClient,
  | "prepareNotificationDelivery"
  | "claimNotificationDelivery"
  | "completeNotificationDelivery"
  | "failNotificationDelivery"
  | "getPendingNotificationDeliveries"
>;
type DiscordNotifier = {
  sendOrEditWatcherMessage: (
    watcher: { guildId: string; channelId: string },
    messageId: string | null,
    embed: EmbedBuilder,
    attempt: DeliveryAttempt,
  ) => Promise<NotificationResult>;
};

async function notificationKey(watcher: MatchWatcher, intentKey: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      watcher.guildId,
      watcher.channelId,
      watcher.targetDiscordId,
      watcher.riotAccountPuuid,
      intentKey,
    ]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(
    digest.slice(0, 12),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function deliveryOrder(intentKey: string) {
  const [kind, id, gameId, previousNotificationAt] = intentKey.split(":");
  if (kind === "started" || kind === "progress") {
    return {
      matchId: `${id.toUpperCase()}_${gameId}`,
      stage: 0,
      revision: kind === "started" ? 0 : Number(previousNotificationAt) + 1,
    };
  }
  const stages: Record<string, number> = { pending: 1, timeout: 2, result: 3 };
  const stage = stages[kind];
  if (stage === undefined) throw new Error("Unknown notification intent");
  return { matchId: id, stage, revision: 0 };
}

export function createDurableMatchTrackingNotifier(deps: {
  store: NotificationDeliveryStore;
  notifier: DiscordNotifier;
  logger: {
    error(
      event: string,
      context?: Record<string, unknown>,
      error?: unknown,
    ): void;
  };
}) {
  async function deliver(
    delivery: NotificationDelivery,
  ): Promise<NotificationResult> {
    if (delivery.status === "delivered" && delivery.messageId) {
      return { status: "sent", messageId: delivery.messageId };
    }
    if (delivery.status === "failed") {
      return {
        status: "permanent_failure",
        reason: delivery.reason ?? "attempt_limit",
      };
    }
    const claim = await deps.store.claimNotificationDelivery(delivery.key);
    if (!claim.success) {
      throw new Error("Notification claim failed", { cause: claim });
    }
    if (!claim.delivery) return { status: "skipped", reason: "backoff" };
    const leased = claim.delivery;
    if (!leased.leaseId) {
      throw new Error("Notification claim did not return lease");
    }
    const uncertain = leased.attempts > 1 &&
      (leased.reason === null ||
        ["send", "invalid_response", "reconciliation"].includes(leased.reason));
    const result = await deps.notifier.sendOrEditWatcherMessage(
      leased,
      leased.messageId,
      new EmbedBuilder(leased.embed),
      { nonce: leased.key, createdAt: leased.createdAt, uncertain },
    );
    if (result.status === "sent" || result.status === "edited") {
      const completed = await deps.store.completeNotificationDelivery(
        leased.key,
        { leaseId: leased.leaseId, messageId: result.messageId },
      );
      if (!completed.success) {
        throw new Error("Notification receipt persistence failed", {
          cause: completed,
        });
      }
    } else if (
      result.status === "retryable_failure" ||
      result.status === "permanent_failure"
    ) {
      const failed = await deps.store.failNotificationDelivery(leased.key, {
        leaseId: leased.leaseId,
        // A later pre-send failure must not erase an earlier unknown send outcome.
        reason: uncertain && result.status === "retryable_failure"
          ? "reconciliation"
          : result.reason,
        permanent: result.status === "permanent_failure",
      });
      if (!failed.success) {
        throw new Error("Notification failure persistence failed", {
          cause: failed,
        });
      }
    }
    return result;
  }

  async function sendOrEditWatcherMessage(
    watcher: MatchWatcher,
    messageId: string | null | undefined,
    embed: EmbedBuilder,
    intentKey: string,
  ) {
    const prepared = await deps.store.prepareNotificationDelivery({
      key: await notificationKey(watcher, intentKey),
      ...deliveryOrder(intentKey),
      guildId: watcher.guildId,
      targetDiscordId: watcher.targetDiscordId,
      riotAccountPuuid: watcher.riotAccountPuuid,
      channelId: watcher.channelId,
      messageId: messageId ?? null,
      embed: { ...embed.toJSON() },
    });
    if (!prepared.success) {
      throw new Error("Notification intent persistence failed", {
        cause: prepared,
      });
    }
    return await deliver(prepared.delivery);
  }

  async function resumePending() {
    const pending = await deps.store.getPendingNotificationDeliveries();
    if (!pending.success) {
      throw new Error("Notification pending read failed", { cause: pending });
    }
    for (const delivery of pending.deliveries) {
      try {
        await deliver(delivery);
      } catch (error) {
        deps.logger.error("match_tracking.delivery_resume_failed", {
          deliveryKey: delivery.key,
        }, error);
      }
    }
  }
  return { sendOrEditWatcherMessage, resumePending };
}
