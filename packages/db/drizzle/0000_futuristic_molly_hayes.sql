CREATE TYPE "public"."box_status" AS ENUM('pending', 'deploying', 'running', 'stopped', 'error', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('sprites', 'docker');--> statement-breakpoint
CREATE TYPE "public"."box_env_var_type" AS ENUM('literal', 'credential_ref');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('email', 'cron', 'webhook', 'manual', 'default');--> statement-breakpoint
CREATE TYPE "public"."box_cronjob_execution_status" AS ENUM('pending', 'waking_box', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."box_deploy_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
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
CREATE TABLE "apikey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"permissions" text,
	"metadata" text,
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
	"provider" "provider_type" DEFAULT 'sprites' NOT NULL,
	"provider_host_id" text,
	"instance_name" text,
	"instance_url" text,
	"sprite_name" text,
	"sprite_url" text,
	"last_checkpoint_id" text,
	"password_hash" text,
	"error_message" text,
	"last_health_check" timestamp,
	"tailscale_ip" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"deployment_attempt" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "box_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "box_env_var" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" "box_env_var_type" NOT NULL,
	"value" text,
	"credential_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_agent_config" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"trigger_type" "trigger_type" DEFAULT 'default' NOT NULL,
	"name" text,
	"model" text DEFAULT 'claude-sonnet-4-5-20250929',
	"system_prompt" text,
	"append_system_prompt" text,
	"tools" text[],
	"allowed_tools" text[],
	"disallowed_tools" text[],
	"permission_mode" text DEFAULT 'bypassPermissions',
	"max_turns" integer,
	"max_budget_usd" numeric(10, 4),
	"persist_session" boolean DEFAULT true,
	"mcp_servers" jsonb,
	"agents" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_cronjob" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schedule" text NOT NULL,
	"prompt" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"bullmq_job_key" text,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_cronjob_execution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cronjob_id" uuid NOT NULL,
	"status" "box_cronjob_execution_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" text,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_deploy_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"box_id" uuid NOT NULL,
	"deployment_attempt" integer DEFAULT 1 NOT NULL,
	"parent_id" uuid,
	"step_key" text NOT NULL,
	"step_order" integer NOT NULL,
	"name" text NOT NULL,
	"status" "box_deploy_step_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "user_credential" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"box_id" uuid,
	"provider" text NOT NULL,
	"capability" text NOT NULL,
	"model_id" text,
	"input_units" integer,
	"output_units" integer,
	"unit_type" text,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box" ADD CONSTRAINT "box_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_env_var" ADD CONSTRAINT "box_env_var_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_agent_config" ADD CONSTRAINT "box_agent_config_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_cronjob" ADD CONSTRAINT "box_cronjob_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_cronjob_execution" ADD CONSTRAINT "box_cronjob_execution_cronjob_id_box_cronjob_id_fk" FOREIGN KEY ("cronjob_id") REFERENCES "public"."box_cronjob"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_deploy_step" ADD CONSTRAINT "box_deploy_step_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_email" ADD CONSTRAINT "box_email_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_email_settings" ADD CONSTRAINT "box_email_settings_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credential" ADD CONSTRAINT "user_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "box_userId_idx" ON "box" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "box_subdomain_idx" ON "box" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "box_status_idx" ON "box" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_provider_idx" ON "box" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "box_env_var_unique_idx" ON "box_env_var" USING btree ("box_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "box_agent_config_box_trigger_idx" ON "box_agent_config" USING btree ("box_id","trigger_type");--> statement-breakpoint
CREATE INDEX "box_agent_config_box_id_idx" ON "box_agent_config" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_cronjob_box_id_idx" ON "box_cronjob" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_cronjob_enabled_idx" ON "box_cronjob" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "box_cronjob_next_run_at_idx" ON "box_cronjob" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "box_cronjob_execution_cronjob_id_idx" ON "box_cronjob_execution" USING btree ("cronjob_id");--> statement-breakpoint
CREATE INDEX "box_cronjob_execution_status_idx" ON "box_cronjob_execution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_cronjob_execution_started_at_idx" ON "box_cronjob_execution" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "box_deploy_step_box_id_idx" ON "box_deploy_step" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_deploy_step_box_attempt_idx" ON "box_deploy_step" USING btree ("box_id","deployment_attempt");--> statement-breakpoint
CREATE INDEX "box_deploy_step_status_idx" ON "box_deploy_step" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_deploy_step_parent_id_idx" ON "box_deploy_step" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "box_email_box_id_idx" ON "box_email" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_email_status_idx" ON "box_email" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_email_received_at_idx" ON "box_email" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "box_email_settings_boxId_idx" ON "box_email_settings" USING btree ("box_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_credential_unique_idx" ON "user_credential" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_box_id_idx" ON "ai_usage" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "ai_usage_provider_idx" ON "ai_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_usage_capability_idx" ON "ai_usage" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");