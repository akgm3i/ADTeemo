import {
  and,
  eq,
  gt,
  gte,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type {
  CompleteNotificationDelivery,
  FailNotificationDelivery,
  PrepareNotificationDelivery,
} from "../../contract/notification_delivery.ts";
import { DomainConflictError, RecordNotFoundError } from "../../errors.ts";
import type { Database } from "../index.ts";
import {
  matchWatchers,
  notificationDeliveries as deliveries,
} from "../schema.ts";

const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 6;

export function createNotificationDeliveriesRepository(database: Database) {
  async function get(key: string) {
    const row = await database.query.notificationDeliveries.findFirst({
      where: eq(deliveries.key, key),
    });
    if (!row) throw new RecordNotFoundError("Notification delivery not found");
    return row;
  }

  async function prepareNotificationDelivery(
    input: PrepareNotificationDelivery,
  ) {
    const now = Date.now();
    await database.transaction(async (tx) => {
      const watcher = await tx.query.matchWatchers.findFirst({
        where: and(
          eq(matchWatchers.guildId, input.guildId),
          eq(matchWatchers.targetDiscordId, input.targetDiscordId),
          eq(matchWatchers.riotAccountPuuid, input.riotAccountPuuid),
          eq(matchWatchers.channelId, input.channelId),
          eq(matchWatchers.enabled, true),
        ),
      });
      // A result post belongs to one account even after its watcher returns IDLE.
      // Reserve the existing post in the same transaction as the first intent.
      const owner = input.stage > 0 && input.messageId
        ? await tx.query.notificationDeliveries.findFirst({
          where: and(
            eq(deliveries.guildId, input.guildId),
            eq(deliveries.channelId, input.channelId),
            eq(deliveries.messageId, input.messageId),
            or(gt(deliveries.stage, 0), isNull(deliveries.stage)),
            or(
              isNull(deliveries.riotAccountPuuid),
              ne(deliveries.riotAccountPuuid, input.riotAccountPuuid),
              ne(deliveries.targetDiscordId, input.targetDiscordId),
            ),
          ),
        })
        : null;
      await tx.insert(deliveries).values({
        ...input,
        messageId: owner ? null : input.messageId,
        status: watcher ? "pending" : "failed",
        reason: watcher ? null : "watch_disabled",
        createdAt: now,
        nextAttemptAt: now,
      }).onConflictDoNothing({ target: deliveries.key }).execute();
      if (watcher) {
        // A fresh intent after opt-in may resume a cancelled delivery, retaining
        // the same nonce and any uncertainty about an earlier Discord send.
        await tx.update(deliveries).set({
          status: "pending",
          reason:
            sql`case when ${deliveries.attempts} > 0 then 'reconciliation' else null end`,
          nextAttemptAt: now,
          leaseUntil: null,
          leaseId: null,
        }).where(and(
          eq(deliveries.key, input.key),
          eq(deliveries.guildId, input.guildId),
          eq(deliveries.targetDiscordId, input.targetDiscordId),
          eq(deliveries.riotAccountPuuid, input.riotAccountPuuid),
          eq(deliveries.channelId, input.channelId),
          eq(deliveries.status, "failed"),
          eq(deliveries.reason, "watch_disabled"),
        )).execute();
      }
    });
    await retireSuperseded(
      and(
        eq(deliveries.guildId, input.guildId),
        eq(deliveries.channelId, input.channelId),
        eq(deliveries.matchId, input.matchId),
      )!,
    );
    const existing = await get(input.key);
    if (
      existing.guildId !== input.guildId ||
      existing.channelId !== input.channelId ||
      existing.targetDiscordId !== input.targetDiscordId ||
      existing.riotAccountPuuid !== input.riotAccountPuuid
    ) {
      throw new DomainConflictError(
        "Notification key belongs to a different scope",
      );
    }
    return existing;
  }

  // Match/channel order is independent of delivery-key idempotency. Active
  // notifications are shared; pending/terminal notifications belong to an account.
  function superseded() {
    return sql`exists (
      select 1 from notification_deliveries newer where
      newer.guild_id = ${deliveries.guildId} and
      newer.channel_id = ${deliveries.channelId} and
      newer.match_id = ${deliveries.matchId} and
      newer.key <> ${deliveries.key} and
      ((${deliveries.stage} = 0 and newer.stage > 0) or
       (((${deliveries.stage} = 0 and newer.stage = 0) or
          (newer.target_discord_id = ${deliveries.targetDiscordId} and
           newer.riot_account_puuid = ${deliveries.riotAccountPuuid})) and
        (newer.stage > ${deliveries.stage} or
         (newer.stage = ${deliveries.stage} and newer.revision > ${deliveries.revision}))))
    )`;
  }

  async function retireSuperseded(scope: SQL) {
    // Do not revoke an in-flight edit: successors wait for its lease to finish.
    await database.update(deliveries).set({
      status: "failed",
      reason: "superseded",
      leaseUntil: null,
    }).where(and(
      eq(deliveries.status, "pending"),
      or(isNull(deliveries.leaseUntil), lte(deliveries.leaseUntil, Date.now())),
      scope,
      superseded(),
    )).execute();
  }

  function due(now: number) {
    return and(
      eq(deliveries.status, "pending"),
      lte(deliveries.nextAttemptAt, now),
      or(isNull(deliveries.leaseUntil), lte(deliveries.leaseUntil, now)),
    );
  }

  async function getPendingNotificationDeliveries() {
    return await database.select().from(deliveries).where(due(Date.now()))
      .orderBy(deliveries.nextAttemptAt, deliveries.createdAt).limit(100);
  }

  async function claimNotificationDelivery(key: string) {
    const now = Date.now();
    await retireSuperseded(eq(deliveries.key, key));
    // Legacy rows have no recoverable ordering metadata. Never replay them over
    // a current post; retain them for explicit reconciliation during upgrade.
    await database.update(deliveries).set({
      status: "failed",
      reason: "ordering_unknown",
      leaseUntil: null,
    }).where(
      and(
        eq(deliveries.key, key),
        eq(deliveries.status, "pending"),
        or(
          isNull(deliveries.matchId),
          isNull(deliveries.stage),
          isNull(deliveries.revision),
        ),
      ),
    ).execute();
    // Recheck eligibility at the claim boundary, including old persisted rows.
    await database.update(deliveries).set({
      status: "failed",
      reason: "watch_disabled",
      leaseUntil: null,
    }).where(
      and(
        eq(deliveries.key, key),
        eq(deliveries.status, "pending"),
        sql`not exists (
      select 1 from ${matchWatchers} where
      ${matchWatchers.guildId} = ${deliveries.guildId} and
      ${matchWatchers.targetDiscordId} = ${deliveries.targetDiscordId} and
      ${matchWatchers.riotAccountPuuid} = ${deliveries.riotAccountPuuid} and
      ${matchWatchers.channelId} = ${deliveries.channelId} and
      ${matchWatchers.enabled} = 1
    )`,
      ),
    ).execute();
    // Also bound retries when a worker dies before recording its failure.
    await database.update(deliveries).set({
      status: "failed",
      reason: "attempt_limit",
      leaseUntil: null,
    }).where(
      and(
        eq(deliveries.key, key),
        due(now),
        gte(deliveries.attempts, MAX_ATTEMPTS),
      ),
    ).execute();
    const [claimed] = await database.update(deliveries).set({
      leaseId: crypto.randomUUID(),
      leaseUntil: now + LEASE_MS,
      attempts: sql`${deliveries.attempts} + 1`,
    }).where(
      and(
        eq(deliveries.key, key),
        due(now),
        lt(deliveries.attempts, MAX_ATTEMPTS),
        not(superseded()),
        // Serialize edits to the same post and notifications within a match
        // stream. A newly prepared result waits for an active edit to complete.
        sql`not exists (
          select 1 from notification_deliveries running where
          running.key <> ${deliveries.key} and
          running.guild_id = ${deliveries.guildId} and
          running.channel_id = ${deliveries.channelId} and
          running.status = 'pending' and running.lease_until > ${now} and
          (running.message_id = ${deliveries.messageId} or
           (running.match_id = ${deliveries.matchId} and
            (running.stage = 0 or ${deliveries.stage} = 0 or
             (running.target_discord_id = ${deliveries.targetDiscordId} and
              running.riot_account_puuid = ${deliveries.riotAccountPuuid}))))
        )`,
      ),
    ).returning();
    if (claimed) return claimed;
    await get(key);
    return null;
  }

  async function completeNotificationDelivery(
    key: string,
    input: CompleteNotificationDelivery,
  ) {
    const [completed] = await database.update(deliveries).set({
      status: "delivered",
      messageId: input.messageId,
      leaseUntil: null,
      reason: null,
    }).where(and(
      eq(deliveries.key, key),
      eq(deliveries.status, "pending"),
      eq(deliveries.leaseId, input.leaseId),
      sql`${deliveries.leaseUntil} > ${Date.now()}`,
    )).returning();
    if (completed) return completed;
    const existing = await get(key);
    if (
      existing.status === "delivered" && existing.leaseId === input.leaseId &&
      existing.messageId === input.messageId
    ) return existing;
    throw new DomainConflictError(
      "Notification delivery lease changed or expired",
    );
  }

  async function failNotificationDelivery(
    key: string,
    input: FailNotificationDelivery,
  ) {
    const now = Date.now();
    const existing = await get(key);
    if (existing.leaseId !== input.leaseId || existing.status === "delivered") {
      throw new DomainConflictError("Notification delivery lease changed");
    }
    // Retain the last lease token after releasing it, so a lost failure response
    // can be replayed without extending backoff. A new claim replaces the token.
    if (
      existing.leaseUntil === null &&
      (existing.reason === input.reason || existing.reason === "attempt_limit")
    ) return existing;
    const terminal = input.permanent || existing.attempts >= MAX_ATTEMPTS;
    const [failed] = await database.update(deliveries).set({
      status: terminal ? "failed" : "pending",
      reason: existing.attempts >= MAX_ATTEMPTS
        ? "attempt_limit"
        : input.reason,
      leaseUntil: null,
      nextAttemptAt: terminal
        ? now
        : now + Math.min(30_000 * 2 ** (existing.attempts - 1), 1_800_000),
    }).where(and(
      eq(deliveries.key, key),
      eq(deliveries.status, "pending"),
      eq(deliveries.leaseId, input.leaseId),
      sql`${deliveries.leaseUntil} > ${now}`,
    )).returning();
    if (!failed) {
      throw new DomainConflictError(
        "Notification delivery lease changed or expired",
      );
    }
    return failed;
  }

  return {
    prepareNotificationDelivery,
    claimNotificationDelivery,
    completeNotificationDelivery,
    failNotificationDelivery,
    getPendingNotificationDeliveries,
  };
}
