ALTER TABLE "tasks" ADD COLUMN "builder_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_review_rounds" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
UPDATE "tasks" AS "task"
SET "builder_agent_id" = "root_run"."agent_id"
FROM (
	SELECT DISTINCT ON ("task_id") "task_id", "agent_id"
	FROM "runs"
	WHERE "trigger_type" = 'user'
	ORDER BY "task_id", "created_at" ASC
) AS "root_run"
WHERE "task"."id" = "root_run"."task_id"
	AND "task"."builder_agent_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_builder_agent_id_agent_profiles_id_fk" FOREIGN KEY ("builder_agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;
