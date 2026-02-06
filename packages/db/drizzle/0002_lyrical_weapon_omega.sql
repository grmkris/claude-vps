CREATE TYPE "public"."agent_inbox_source_type" AS ENUM('external', 'box', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_inbox_status" AS ENUM('pending', 'delivered', 'read');--> statement-breakpoint
CREATE TYPE "public"."agent_inbox_type" AS ENUM('email', 'cron', 'webhook', 'message');--> statement-breakpoint
CREATE TYPE "public"."agent_inbox_notification_status" AS ENUM('unread', 'read');--> statement-breakpoint
CREATE TYPE "public"."notification_mode" AS ENUM('gentle', 'insistent');--> statement-breakpoint
CREATE TABLE "agent_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"type" "agent_inbox_type" NOT NULL,
	"status" "agent_inbox_status" DEFAULT 'pending' NOT NULL,
	"content" text NOT NULL,
	"parent_id" uuid,
	"source_type" "agent_inbox_source_type" NOT NULL,
	"source_box_id" uuid,
	"source_external" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_inbox_notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbox_id" uuid NOT NULL,
	"target_box_id" uuid NOT NULL,
	"target_session_key" text,
	"status" "agent_inbox_notification_status" DEFAULT 'unread' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_agent_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"agent_secret" text NOT NULL,
	"identity_name" text,
	"notification_mode" "notification_mode" DEFAULT 'gentle' NOT NULL,
	"delivery_config" jsonb DEFAULT '{"email":"spawn","cron":"spawn","webhook":"notify","message":"notify"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_agent_settings_box_id_unique" UNIQUE("box_id")
);
--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox_notification" ADD CONSTRAINT "agent_inbox_notification_inbox_id_agent_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."agent_inbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox_notification" ADD CONSTRAINT "agent_inbox_notification_target_box_id_box_id_fk" FOREIGN KEY ("target_box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_agent_settings" ADD CONSTRAINT "box_agent_settings_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_inbox_box_id_idx" ON "agent_inbox" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_type_idx" ON "agent_inbox" USING btree ("type");--> statement-breakpoint
CREATE INDEX "agent_inbox_status_idx" ON "agent_inbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_inbox_created_at_idx" ON "agent_inbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_inbox_parent_id_idx" ON "agent_inbox" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_source_box_id_idx" ON "agent_inbox" USING btree ("source_box_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_notification_inbox_id_idx" ON "agent_inbox_notification" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_notification_target_box_id_idx" ON "agent_inbox_notification" USING btree ("target_box_id");--> statement-breakpoint
CREATE INDEX "agent_inbox_notification_status_idx" ON "agent_inbox_notification" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_inbox_notification_session_key_idx" ON "agent_inbox_notification" USING btree ("target_session_key");--> statement-breakpoint
CREATE INDEX "box_agent_settings_box_id_idx" ON "box_agent_settings" USING btree ("box_id");