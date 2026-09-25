import { z } from "zod";

export const notificationFailureReasons = [
  "channel_fetch",
  "channel_missing",
  "message_fetch",
  "edit",
  "send",
  "invalid_response",
  "reconciliation",
  "attempt_limit",
  "watch_disabled",
  "superseded",
  "ordering_unknown",
] as const;
export const notificationFailureReasonSchema = z.enum(
  notificationFailureReasons,
);
export type NotificationFailureReason = z.infer<
  typeof notificationFailureReasonSchema
>;

export const notificationDeliveryKeySchema = z.object({
  key: z.string().min(1).max(256),
});
// Keep recursive JSON validation at runtime without expanding JSONParsed in RPC types.
const embedSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.json(),
);

export const prepareNotificationDeliverySchema = z.object({
  guildId: z.string().min(1),
  targetDiscordId: z.string().min(1),
  riotAccountPuuid: z.string().min(1),
  channelId: z.string().min(1),
  messageId: z.string().min(1).nullable(),
  embed: embedSchema,
  matchId: z.string().min(1),
  // 0: active, 1: pending result, 2: timeout, 3: confirmed result.
  stage: z.number().int().min(0).max(3),
  revision: z.number().int().nonnegative(),
});
export const completeNotificationDeliverySchema = z.object({
  leaseId: z.string().min(1),
  messageId: z.string().min(1),
});
export const failNotificationDeliverySchema = z.object({
  leaseId: z.string().min(1),
  reason: notificationFailureReasonSchema,
  permanent: z.boolean(),
});
export const notificationDeliverySchema = prepareNotificationDeliverySchema
  .extend({
    riotAccountPuuid: z.string().min(1).nullable(),
    matchId: z.string().nullable(),
    stage: z.number().int().nullable(),
    revision: z.number().int().nullable(),
    key: z.string().min(1),
    status: z.enum(["pending", "delivered", "failed"]),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.number().int().nonnegative(),
    leaseId: z.string().nullable(),
    leaseUntil: z.number().int().nonnegative().nullable(),
    reason: notificationFailureReasonSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
  });
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export type PrepareNotificationDelivery =
  & z.infer<typeof prepareNotificationDeliverySchema>
  & { key: string };
export type CompleteNotificationDelivery = z.infer<
  typeof completeNotificationDeliverySchema
>;
export type FailNotificationDelivery = z.infer<
  typeof failNotificationDeliverySchema
>;
