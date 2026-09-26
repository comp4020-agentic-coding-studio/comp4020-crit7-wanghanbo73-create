DROP TABLE `messages`;--> statement-breakpoint
CREATE TABLE `offerings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_code` text NOT NULL,
	`session_type` text NOT NULL,
	`day` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`location` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `selections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`offering_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE no action
);
