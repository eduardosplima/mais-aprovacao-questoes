PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`statement` text NOT NULL,
	`subject_id` text NOT NULL,
	`banca_id` text NOT NULL,
	`cargo_id` text,
	`level_id` text,
	`year` integer NOT NULL,
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
INSERT INTO `__new_questions`("id", "type", "statement", "subject_id", "banca_id", "cargo_id", "level_id", "year", "status", "created_by", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "statement", "subject_id", "banca_id", "cargo_id", "level_id", "year", "status", "created_by", "created_at", "updated_at", "deleted_at" FROM `questions`;--> statement-breakpoint
DROP TABLE `questions`;--> statement-breakpoint
ALTER TABLE `__new_questions` RENAME TO `questions`;--> statement-breakpoint
CREATE INDEX `questions_subject_idx` ON `questions` (`subject_id`);--> statement-breakpoint
CREATE INDEX `questions_banca_idx` ON `questions` (`banca_id`);--> statement-breakpoint
CREATE INDEX `questions_status_idx` ON `questions` (`status`);