CREATE TABLE `notification_deliveries` (
	`key` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`target_discord_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`embed` text NOT NULL,
	`message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_due` ON `notification_deliveries` (`status`,`next_attempt_at`);