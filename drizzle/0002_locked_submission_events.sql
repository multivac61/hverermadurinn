CREATE TABLE `submission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`session_id` text NOT NULL,
	`input_text` text NOT NULL,
	`intent_kind` text NOT NULL,
	`resolved_kind` text NOT NULL,
	`normalized_guess_text` text,
	`answer_label` text,
	`answer_text_is` text,
	`guess_correct` integer,
	`question_count` integer NOT NULL,
	`remaining` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_submission_events_round_created` ON `submission_events` (`round_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_submission_events_session_created` ON `submission_events` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `submission_events_no_update`
BEFORE UPDATE ON `submission_events`
BEGIN
	SELECT RAISE(ABORT, 'SUBMISSION_EVENTS_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `submission_events_no_delete`
BEFORE DELETE ON `submission_events`
BEGIN
	SELECT RAISE(ABORT, 'SUBMISSION_EVENTS_IMMUTABLE');
END;