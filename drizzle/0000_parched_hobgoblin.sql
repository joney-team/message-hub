CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`ref` text,
	`webhook_url` text,
	`webhook_secret` text NOT NULL,
	`settings` text NOT NULL,
	`allowed_origins` text NOT NULL,
	`connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `channels_owner_ref_idx` ON `channels` (`owner`,`ref`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`visitor_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_channel_idx` ON `files` (`channel_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`channel_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`direction` text NOT NULL,
	`text` text NOT NULL,
	`attachments` text NOT NULL,
	`sender` text,
	`context` text,
	`client_message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_idx` ON `messages` (`id`);--> statement-breakpoint
CREATE INDEX `messages_visitor_seq_idx` ON `messages` (`visitor_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_visitor_client_msg_idx` ON `messages` (`visitor_id`,`client_message_id`);--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`locale` text,
	`profile` text NOT NULL,
	`user_agent` text,
	`origin` text,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitors_token_hash_idx` ON `visitors` (`token_hash`);--> statement-breakpoint
CREATE INDEX `visitors_channel_last_seen_idx` ON `visitors` (`channel_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_status` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deliveries_status_next_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `deliveries_channel_status_idx` ON `webhook_deliveries` (`channel_id`,`status`,`id`);