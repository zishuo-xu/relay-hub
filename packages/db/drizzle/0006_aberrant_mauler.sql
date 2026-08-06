ALTER TABLE "tasks" ADD COLUMN "reviewer_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_agent_id_agent_profiles_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_source_run_uidx" ON "handoffs" USING btree ("source_run_id");