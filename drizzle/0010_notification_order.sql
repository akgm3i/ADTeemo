ALTER TABLE `notification_deliveries` ADD `match_id` text;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `stage` integer;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `revision` integer;--> statement-breakpoint
CREATE INDEX `notification_deliveries_match` ON `notification_deliveries` (`guild_id`,`channel_id`,`match_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_message` ON `notification_deliveries` (`guild_id`,`channel_id`,`message_id`);