CREATE TABLE `alternatives` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`body` text NOT NULL,
	`is_correct` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alternatives_question_idx` ON `alternatives` (`question_id`);--> statement-breakpoint
CREATE TABLE `explanations` (
	`question_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`video_url` text,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`statement` text NOT NULL,
	`subject_id` text NOT NULL,
	`banca_id` text NOT NULL,
	`cargo_id` text,
	`level_id` text,
	`year` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`subject_id`) REFERENCES `taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`banca_id`) REFERENCES `taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cargo_id`) REFERENCES `taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_subject_idx` ON `questions` (`subject_id`);--> statement-breakpoint
CREATE INDEX `questions_banca_idx` ON `questions` (`banca_id`);--> statement-breakpoint
CREATE INDEX `questions_status_idx` ON `questions` (`status`);--> statement-breakpoint
CREATE TABLE `taxonomy_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_terms_kind_slug_idx` ON `taxonomy_terms` (`kind`,`slug`) WHERE "taxonomy_terms"."deleted_at" is null;