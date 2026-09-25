CREATE TABLE `guild_match_watch_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`notification_channel_id` text,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `guild_members` (
	`guild_id` text NOT NULL,
	`discord_id` text NOT NULL,
	PRIMARY KEY(`guild_id`, `discord_id`),
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `match_watcher_opt_outs` (
	`guild_id` text NOT NULL,
	`target_discord_id` text NOT NULL,
	PRIMARY KEY(`guild_id`, `target_discord_id`),
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `__new_riot_accounts` (
	`discord_id` text NOT NULL,
	`puuid` text PRIMARY KEY NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`game_name` text NOT NULL,
	`tag_line` text NOT NULL,
	`platform` text NOT NULL,
	`region` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_riot_accounts`("discord_id", "puuid", "is_main", "game_name", "tag_line", "platform", "region", "created_at", "updated_at") SELECT "discord_id", "puuid", 1, "game_name", "tag_line", "platform", "region", "created_at", "updated_at" FROM `riot_accounts`;--> statement-breakpoint
DROP TABLE `riot_accounts`;--> statement-breakpoint
ALTER TABLE `__new_riot_accounts` RENAME TO `riot_accounts`;--> statement-breakpoint
CREATE INDEX `riot_accounts_owner` ON `riot_accounts` (`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `riot_accounts_one_main` ON `riot_accounts` (`discord_id`) WHERE "riot_accounts"."is_main" = 1;--> statement-breakpoint
CREATE TABLE `__new_match_watchers` (
	`guild_id` text NOT NULL,
	`riot_account_puuid` text NOT NULL,
	`target_discord_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_state` text DEFAULT 'IDLE' NOT NULL,
	`current_game_id` text,
	`current_match_id` text,
	`current_notification_message_id` text,
	`pending_result_match_id` text,
	`pending_result_notification_message_id` text,
	`pending_result_started_at` integer,
	`game_started_at` integer,
	`last_checked_at` integer,
	`last_in_game_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	PRIMARY KEY(`guild_id`, `riot_account_puuid`),
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`riot_account_puuid`) REFERENCES `riot_accounts`(`puuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_match_watchers`("guild_id", "riot_account_puuid", "target_discord_id", "requester_id", "channel_id", "enabled", "last_state", "current_game_id", "current_match_id", "current_notification_message_id", "pending_result_match_id", "pending_result_notification_message_id", "pending_result_started_at", "game_started_at", "last_checked_at", "last_in_game_notified_at", "created_at", "updated_at") SELECT "guild_id", (SELECT "puuid" FROM "riot_accounts" WHERE "discord_id" = "match_watchers"."target_discord_id"), "target_discord_id", "requester_id", "channel_id", "enabled", "last_state", "current_game_id", "current_match_id", "current_notification_message_id", "pending_result_match_id", "pending_result_notification_message_id", "pending_result_started_at", "game_started_at", "last_checked_at", "last_in_game_notified_at", "created_at", "updated_at" FROM `match_watchers`;--> statement-breakpoint
DROP TABLE `match_watchers`;--> statement-breakpoint
ALTER TABLE `__new_match_watchers` RENAME TO `match_watchers`;--> statement-breakpoint
ALTER TABLE `auth_states` ADD `guild_id` text;--> statement-breakpoint
ALTER TABLE `auth_states` ADD `platform` text DEFAULT 'jp1' NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_states` ADD `region` text DEFAULT 'asia' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `riot_account_puuid` text;
--> statement-breakpoint
UPDATE notification_deliveries SET riot_account_puuid = (SELECT puuid FROM riot_accounts WHERE discord_id = notification_deliveries.target_discord_id AND is_main = 1);
--> statement-breakpoint
UPDATE notification_deliveries SET status = 'failed', reason = 'watch_disabled', lease_until = NULL WHERE status = 'pending' AND riot_account_puuid IS NULL;
--> statement-breakpoint
INSERT INTO guild_members (guild_id, discord_id) SELECT DISTINCT guild_id, target_discord_id FROM match_watchers;
--> statement-breakpoint
INSERT INTO match_watcher_opt_outs (guild_id, target_discord_id) SELECT DISTINCT guild_id, target_discord_id FROM match_watchers WHERE enabled = 0;
--> statement-breakpoint
INSERT INTO guild_match_watch_settings (guild_id, enabled, notification_channel_id)
SELECT guild_id, CASE WHEN COUNT(DISTINCT channel_id) = 1 THEN 1 ELSE 0 END,
CASE WHEN COUNT(DISTINCT channel_id) = 1 THEN MIN(channel_id) ELSE NULL END
FROM match_watchers GROUP BY guild_id;
