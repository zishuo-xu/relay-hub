CREATE TABLE "responsibility_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"action" text NOT NULL,
	"source_type" text NOT NULL,
	"target_type" text NOT NULL,
	"source_run_id" uuid,
	"target_run_id" uuid,
	"source_agent_id" uuid,
	"target_agent_id" uuid,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_target_run_id_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_source_agent_id_agent_profiles_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_routes" ADD CONSTRAINT "responsibility_routes_target_agent_id_agent_profiles_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "responsibility_routes_thread_created_idx" ON "responsibility_routes" USING btree ("thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "responsibility_routes_task_created_idx" ON "responsibility_routes" USING btree ("task_id","created_at","id");