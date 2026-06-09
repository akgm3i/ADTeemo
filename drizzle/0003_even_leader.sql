CREATE TABLE `riot_static_data_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `match_watchers` ADD `current_notification_message_id` text;--> statement-breakpoint
ALTER TABLE `match_watchers` ADD `pending_result_match_id` text;--> statement-breakpoint
ALTER TABLE `match_watchers` ADD `pending_result_notification_message_id` text;--> statement-breakpoint
ALTER TABLE `match_watchers` ADD `pending_result_started_at` integer;