CREATE TYPE "public"."box_deploy_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
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
ALTER TABLE "box" ADD COLUMN "deployment_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "box_deploy_step" ADD CONSTRAINT "box_deploy_step_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_deploy_step_box_id_idx" ON "box_deploy_step" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_deploy_step_box_attempt_idx" ON "box_deploy_step" USING btree ("box_id","deployment_attempt");--> statement-breakpoint
CREATE INDEX "box_deploy_step_status_idx" ON "box_deploy_step" USING btree ("status");--> statement-breakpoint
CREATE INDEX "box_deploy_step_parent_id_idx" ON "box_deploy_step" USING btree ("parent_id");