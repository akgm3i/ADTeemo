CREATE TABLE `match_rank_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`puuid` text NOT NULL,
	`platform` text NOT NULL,
	`queue_type` text NOT NULL,
	`phase` text NOT NULL,
	`tier` text,
	`rank` text,
	`league_points` integer,
	`wins` integer,
	`losses` integer,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_rank_snapshots_unique_snapshot` ON `match_rank_snapshots` (`match_id`,`puuid`,`queue_type`,`phase`);--> statement-breakpoint
CREATE TABLE `pending_match_rank_snapshots` (
	`platform` text NOT NULL,
	`game_id` text NOT NULL,
	`puuid` text NOT NULL,
	`queue_type` text NOT NULL,
	`tier` text,
	`rank` text,
	`league_points` integer,
	`wins` integer,
	`losses` integer,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`platform`, `game_id`, `puuid`, `queue_type`)
);
