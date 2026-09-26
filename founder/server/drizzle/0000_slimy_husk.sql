CREATE TABLE `founder_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`mutation_id` text NOT NULL
);
