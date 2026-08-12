CREATE TYPE "public"."consultation_status" AS ENUM('pending', 'dispatched', 'answered', 'resumed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."run_trigger" ADD VALUE 'consult';--> statement-breakpoint
ALTER TYPE "public"."run_trigger" ADD VALUE 'continuation';--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"target_run_id" uuid,
	"continuation_run_id" uuid,
	"question" text NOT NULL,
	"context_summary" text NOT NULL,
	"response" text,
	"status" "consultation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_source_agent_id_agent_profiles_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_target_agent_id_agent_profiles_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_target_run_id_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_continuation_run_id_runs_id_fk" FOREIGN KEY ("continuation_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consultations_source_run_uidx" ON "consultations" USING btree ("source_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consultations_target_run_uidx" ON "consultations" USING btree ("target_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consultations_continuation_run_uidx" ON "consultations" USING btree ("continuation_run_id");--> statement-breakpoint
CREATE INDEX "consultations_task_created_idx" ON "consultations" USING btree ("task_id","created_at");