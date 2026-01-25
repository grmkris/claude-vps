CREATE TABLE `sessions` (
	`context_type` text NOT NULL,
	`context_id` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`context_type`, `context_id`)
);
