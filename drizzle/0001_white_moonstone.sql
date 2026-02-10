CREATE TABLE `usernames` (
	`device_id_hash` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usernames_username_normalized_unique` ON `usernames` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_usernames_username_normalized` ON `usernames` (`username_normalized`);