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
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_box_id_idx" ON "ai_usage" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "ai_usage_provider_idx" ON "ai_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_usage_capability_idx" ON "ai_usage" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");