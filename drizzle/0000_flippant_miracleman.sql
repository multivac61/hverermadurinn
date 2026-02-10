CREATE TABLE `device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id_hash` text NOT NULL,
	`round_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL,
	`hint_used` integer DEFAULT false NOT NULL,
	`solved` integer DEFAULT false NOT NULL,
	`solved_at` integer,
	`solve_question_index` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_sessions_device_round_unique` ON `device_sessions` (`device_id_hash`,`round_id`);--> statement-breakpoint
CREATE INDEX `idx_device_sessions_round_solved` ON `device_sessions` (`round_id`,`solved`,`solved_at`);--> statement-breakpoint
CREATE TABLE `guess_events` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`session_id` text NOT NULL,
	`guess_text` text NOT NULL,
	`is_correct` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_guess_events_session_created` ON `guess_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`slug` text NOT NULL,
	`description_is` text NOT NULL,
	`image_url` text,
	`metadata_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persons_slug_unique` ON `persons` (`slug`);--> statement-breakpoint
CREATE TABLE `question_events` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`session_id` text NOT NULL,
	`question_text` text NOT NULL,
	`answer_label` text NOT NULL,
	`answer_text_is` text NOT NULL,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_question_events_session_created` ON `question_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`date_ymd` text NOT NULL,
	`person_id` text NOT NULL,
	`opens_at_utc` integer NOT NULL,
	`closes_at_utc` integer NOT NULL,
	`status_override` text,
	`hint_text_is` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_date_ymd_unique` ON `rounds` (`date_ymd`);--> statement-breakpoint
CREATE INDEX `idx_rounds_date_ymd` ON `rounds` (`date_ymd`);