CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`hotmart_subscriber_code` text,
	`plan` text,
	`status` text DEFAULT 'none' NOT NULL,
	`current_period_end` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`hotmart_user_id` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_hotmart_user_id_unique` ON `users` (`hotmart_user_id`);