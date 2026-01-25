DROP TABLE "box_skill" CASCADE;--> statement-breakpoint
DROP TABLE "skill" CASCADE;--> statement-breakpoint
ALTER TABLE "box" ADD COLUMN "skills" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "box" DROP COLUMN "telegram_bot_token";--> statement-breakpoint
ALTER TABLE "box" DROP COLUMN "telegram_chat_id";