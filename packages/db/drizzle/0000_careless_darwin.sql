CREATE TYPE "public"."completion_policy" AS ENUM('auto_on_approval', 'require_user_confirmation', 'risk_based');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('api', 'worker', 'agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('blocking', 'should_fix', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('pending', 'accepted', 'dispatched', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'published');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('approved', 'changes_requested', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'claimed', 'starting', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('user', 'handoff', 'review', 'retry');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'queued', 'running', 'reviewing', 'changes_requested', 'waiting_for_user', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"adapter_type" text NOT NULL,
	"provider" text,
	"model_label" text,
	"model_family" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_run_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"target_run_id" uuid,
	"objective" text NOT NULL,
	"context_summary" text NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "handoff_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"file_path" text,
	"line_start" integer,
	"line_end" integer,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"suggestion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"verdict" "review_verdict" NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "event_source" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"retry_of_run_id" uuid,
	"trigger_type" "run_trigger" DEFAULT 'user' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"worker_id" text,
	"lease_expires_at" timestamp with time zone,
	"session_ref" text,
	"failure_code" text,
	"failure_detail" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"completion_policy" "completion_policy" DEFAULT 'require_user_confirmation' NOT NULL,
	"current_run_id" uuid,
	"requested_by" text DEFAULT 'local-operator' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"root_path" text NOT NULL,
	"default_completion_policy" "completion_policy" DEFAULT 'require_user_confirmation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_target_agent_id_agent_profiles_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_target_run_id_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agent_profiles_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profiles_workspace_name_uidx" ON "agent_profiles" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key_uidx" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_dedupe_uidx" ON "run_events" USING btree ("run_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "run_events_task_id_idx" ON "run_events" USING btree ("task_id","id");--> statement-breakpoint
CREATE INDEX "runs_task_created_idx" ON "runs" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_created_idx" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tasks_workspace_created_idx" ON "tasks" USING btree ("workspace_id","created_at");