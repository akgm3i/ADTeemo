CREATE TABLE `custom_game_event_participants` (
	`event_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`team` text NOT NULL,
	`lane` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `custom_game_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_game_event_participants_unique_team_lane` ON `custom_game_event_participants` (`event_id`,`team`,`lane`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_custom_game_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_key` text,
	`name` text NOT NULL,
	`guild_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`recruitment_channel_id` text,
	`voice_channel_id` text,
	`discord_scheduled_event_id` text,
	`recruitment_message_id` text,
	`phase` text DEFAULT 'RECRUITING' NOT NULL,
	`sync_state` text DEFAULT 'CONSISTENT' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`discord_event_deleted` integer DEFAULT false NOT NULL,
	`recruitment_message_deleted` integer DEFAULT false NOT NULL,
	`last_failure_code` text,
	`scheduled_start_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_custom_game_events`("id", "operation_key", "name", "guild_id", "creator_id", "recruitment_channel_id", "voice_channel_id", "discord_scheduled_event_id", "recruitment_message_id", "phase", "sync_state", "revision", "discord_event_deleted", "recruitment_message_deleted", "last_failure_code", "scheduled_start_at", "created_at", "updated_at") SELECT "id", NULL, "name", "guild_id", "creator_id", NULL, NULL, "discord_scheduled_event_id", "recruitment_message_id", 'RECRUITING', 'CONSISTENT', 0, false, false, NULL, "scheduled_start_at", "created_at", NULL FROM `custom_game_events`;--> statement-breakpoint
DROP TABLE `custom_game_events`;--> statement-breakpoint
ALTER TABLE `__new_custom_game_events` RENAME TO `custom_game_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `custom_game_events_operation_key_unique` ON `custom_game_events` (`operation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_game_events_discord_scheduled_event_id_unique` ON `custom_game_events` (`discord_scheduled_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_game_events_recruitment_message_id_unique` ON `custom_game_events` (`recruitment_message_id`);--> statement-breakpoint
ALTER TABLE `match_participants` ADD `riot_puuid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `match_participants_unique_match_user` ON `match_participants` (`match_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `matches` ADD `custom_game_event_id` integer REFERENCES custom_game_events(id);--> statement-breakpoint
ALTER TABLE `matches` ADD `game_sequence` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `matches_unique_custom_game_sequence` ON `matches` (`custom_game_event_id`,`game_sequence`);
