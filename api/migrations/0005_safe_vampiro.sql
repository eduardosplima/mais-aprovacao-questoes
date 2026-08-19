-- Em D1, toda query roda dentro de uma transação implícita, e o SQLite
-- ignora `PRAGMA foreign_keys` dentro de transação — por isso a PRAGMA que
-- o drizzle-kit gera para desligar a FK durante o rebuild é um no-op em
-- produção (funciona só localmente, no Miniflare, o que escondia o problema).
-- Sem ela, o `DROP TABLE questions` abaixo dispara de verdade o `ON DELETE
-- CASCADE` de `alternatives` e `explanations`, apagando as duas tabelas
-- inteiras. A saída é salvar as duas em tabelas temporárias antes do DROP e
-- restaurá-las depois do RENAME — refaça esse mesmo passo se um rebuild
-- futuro precisar dropar `questions` de novo.
UPDATE questions SET created_by = NULL;--> statement-breakpoint
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
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`email`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_questions`("id", "type", "statement", "subject_id", "banca_id", "cargo_id", "level_id", "year", "status", "created_by", "created_at", "updated_at", "deleted_at") SELECT "id", "type", "statement", "subject_id", "banca_id", "cargo_id", "level_id", "year", "status", "created_by", "created_at", "updated_at", "deleted_at" FROM `questions`;--> statement-breakpoint
CREATE TABLE `__save_alternatives` AS SELECT * FROM `alternatives`;--> statement-breakpoint
CREATE TABLE `__save_explanations` AS SELECT * FROM `explanations`;--> statement-breakpoint
DROP TABLE `questions`;--> statement-breakpoint
ALTER TABLE `__new_questions` RENAME TO `questions`;--> statement-breakpoint
INSERT INTO `alternatives` (`id`, `question_id`, `position`, `body`, `is_correct`) SELECT `id`, `question_id`, `position`, `body`, `is_correct` FROM `__save_alternatives`;--> statement-breakpoint
INSERT INTO `explanations` (`question_id`, `body`, `video_url`) SELECT `question_id`, `body`, `video_url` FROM `__save_explanations`;--> statement-breakpoint
DROP TABLE `__save_alternatives`;--> statement-breakpoint
DROP TABLE `__save_explanations`;--> statement-breakpoint
CREATE INDEX `questions_subject_idx` ON `questions` (`subject_id`);--> statement-breakpoint
CREATE INDEX `questions_banca_idx` ON `questions` (`banca_id`);--> statement-breakpoint
CREATE INDEX `questions_status_idx` ON `questions` (`status`);
