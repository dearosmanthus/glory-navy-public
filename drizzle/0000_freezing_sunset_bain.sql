CREATE TABLE `appraisal_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `appraisal_rate_limits_expires_at_idx` ON `appraisal_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `appraisals` (
	`code` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `appraisals_expires_at_idx` ON `appraisals` (`expires_at`);