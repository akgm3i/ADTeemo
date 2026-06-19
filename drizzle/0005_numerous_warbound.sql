CREATE TABLE `external_match_details` (
	`match_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_region` text NOT NULL,
	`provider_match_id` text NOT NULL,
	`detail_url` text NOT NULL,
	`provider_created_at` integer NOT NULL,
	`average_tier` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `provider`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_match_details_unique_provider_match` ON `external_match_details` (`provider`,`provider_region`,`provider_match_id`);--> statement-breakpoint
CREATE TABLE `external_match_participant_details` (
	`match_id` text NOT NULL,
	`provider` text NOT NULL,
	`puuid` text NOT NULL,
	`participant_id` integer,
	`lane_score` real,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `provider`, `puuid`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
