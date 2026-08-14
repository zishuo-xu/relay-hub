CREATE TYPE "public"."delegation_plan_status" AS ENUM('pending', 'running', 'resumed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delegation_status" AS ENUM('proposed', 'queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."run_trigger" ADD VALUE 'delegation';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'waiting_on_children' BEFORE 'waiting_for_user';--> statement-breakpoint
CREATE TABLE "delegation_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_task_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"continuation_run_id" uuid,
	"reporting_mode" text DEFAULT 'final_only' NOT NULL,
	"status" "delegation_plan_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"reviewer_agent_id" uuid,
	"child_thread_id" uuid,
	"child_task_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"scope" text NOT NULL,
	"deliverables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "delegation_status" DEFAULT 'proposed' NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "specialties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "delegation_plans" ADD CONSTRAINT "delegation_plans_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_plans" ADD CONSTRAINT "delegation_plans_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_plans" ADD CONSTRAINT "delegation_plans_source_agent_id_agent_profiles_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_plans" ADD CONSTRAINT "delegation_plans_continuation_run_id_runs_id_fk" FOREIGN KEY ("continuation_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_plan_id_delegation_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."delegation_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_target_agent_id_agent_profiles_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_reviewer_agent_id_agent_profiles_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_child_thread_id_threads_id_fk" FOREIGN KEY ("child_thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_child_task_id_tasks_id_fk" FOREIGN KEY ("child_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_plans_source_run_uidx" ON "delegation_plans" USING btree ("source_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_plans_continuation_run_uidx" ON "delegation_plans" USING btree ("continuation_run_id");--> statement-breakpoint
CREATE INDEX "delegation_plans_parent_created_idx" ON "delegation_plans" USING btree ("parent_task_id","created_at");--> statement-breakpoint
CREATE INDEX "delegations_plan_created_idx" ON "delegations" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_child_task_uidx" ON "delegations" USING btree ("child_task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_created_idx" ON "tasks" USING btree ("parent_task_id","created_at");