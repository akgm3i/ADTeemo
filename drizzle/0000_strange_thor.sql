CREATE TABLE `auth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_game_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`guild_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`discord_scheduled_event_id` text NOT NULL,
	`recruitment_message_id` text NOT NULL,
	`scheduled_start_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_game_events_discord_scheduled_event_id_unique` ON `custom_game_events` (`discord_scheduled_event_id`);--> statement-breakpoint
CREATE TABLE `guilds` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `match_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team` text NOT NULL,
	`win` integer NOT NULL,
	`lane` text NOT NULL,
	`kills` integer NOT NULL,
	`deaths` integer NOT NULL,
	`assists` integer NOT NULL,
	`cs` integer NOT NULL,
	`gold` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `match_watchers` (
	`guild_id` text NOT NULL,
	`target_discord_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_state` text DEFAULT 'IDLE' NOT NULL,
	`current_game_id` text,
	`current_match_id` text,
	`game_started_at` integer,
	`last_checked_at` integer,
	`last_in_game_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	PRIMARY KEY(`guild_id`, `target_discord_id`),
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `riot_accounts` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`puuid` text NOT NULL,
	`game_name` text NOT NULL,
	`tag_line` text NOT NULL,
	`platform` text NOT NULL,
	`region` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_guild_profiles` (
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`main_role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	PRIMARY KEY(`user_id`, `guild_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`riot_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
