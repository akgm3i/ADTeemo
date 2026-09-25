CREATE TABLE `custom_game_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`recruitment_channel_id` text NOT NULL,
	`lobby_channel_id` text NOT NULL,
	`red_channel_id` text NOT NULL,
	`blue_channel_id` text NOT NULL,
	`role_ids` text NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
