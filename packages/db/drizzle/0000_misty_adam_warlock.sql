CREATE TYPE "public"."box_status" AS ENUM('pending', 'deploying', 'running', 'error', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."box_email_status" AS ENUM('received', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "box" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"status" "box_status" DEFAULT 'pending' NOT NULL,
	"coolify_application_uuid" text,
	"container_name" text,
	"password_hash" text,
	"error_message" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "box_email" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"email_message_id" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_email" text NOT NULL,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"raw_email" text,
	"status" "box_email_status" DEFAULT 'received' NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_email_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"agent_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_email_settings_box_id_unique" UNIQUE("box_id")
);
--> statement-breakpoint
CREATE TABLE "box_skill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_secret" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"apt_packages" text[] DEFAULT '{}' NOT NULL,
	"npm_packages" text[] DEFAULT '{}' NOT NULL,
	"pip_packages" text[] DEFAULT '{}' NOT NULL,
	"skill_md_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box" ADD CONSTRAINT "box_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_email" ADD CONSTRAINT "box_email_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_email_settings" ADD CONSTRAINT "box_email_settings_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_skill" ADD CONSTRAINT "box_skill_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_skill" ADD CONSTRAINT "box_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_secret" ADD CONSTRAINT "user_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "box_userId_idx" ON "box" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "box_subdomain_idx" ON "box" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "box_status_idx" ON "box" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_email_box_id_idx" ON "box_email" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_email_status_idx" ON "box_email" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_email_received_at_idx" ON "box_email" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "box_email_settings_boxId_idx" ON "box_email_settings" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_skill_boxId_idx" ON "box_skill" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_skill_skillId_idx" ON "box_skill" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "box_skill_unique_idx" ON "box_skill" USING btree ("box_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_secret_unique_idx" ON "user_secret" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_user_slug_unique_idx" ON "skill" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "skill_userId_idx" ON "skill" USING btree ("user_id");