CREATE TYPE "public"."provider_type" AS ENUM('sprites', 'docker');--> statement-breakpoint
ALTER TABLE "box" ADD COLUMN "provider" "provider_type" DEFAULT 'sprites' NOT NULL;--> statement-breakpoint
ALTER TABLE "box" ADD COLUMN "provider_host_id" text;--> statement-breakpoint
ALTER TABLE "box" ADD COLUMN "instance_name" text;--> statement-breakpoint
ALTER TABLE "box" ADD COLUMN "instance_url" text;--> statement-breakpoint
CREATE INDEX "box_provider_idx" ON "box" USING btree ("provider");