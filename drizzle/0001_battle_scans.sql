CREATE TABLE `battle_scans` (
	`code` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `battle_scans_expires_at_idx` ON `battle_scans` (`expires_at`);