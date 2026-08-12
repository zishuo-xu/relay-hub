ALTER TABLE "tasks" ADD COLUMN "conversation_context_before_sequence" bigint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "conversation_context_policy_version" integer;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "message_sequence_high_water" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "sequence" bigint;--> statement-breakpoint
WITH "ranked_messages" AS (
	SELECT
		"id",
		row_number() OVER (PARTITION BY "thread_id" ORDER BY "created_at", "id") AS "assigned_sequence"
	FROM "thread_messages"
)
UPDATE "thread_messages"
SET "sequence" = "ranked_messages"."assigned_sequence"
FROM "ranked_messages"
WHERE "thread_messages"."id" = "ranked_messages"."id";--> statement-breakpoint
UPDATE "threads"
SET "message_sequence_high_water" = COALESCE((
	SELECT max("thread_messages"."sequence")
	FROM "thread_messages"
	WHERE "thread_messages"."thread_id" = "threads"."id"
), 0);--> statement-breakpoint
ALTER TABLE "thread_messages" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
DROP INDEX "thread_messages_thread_created_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "thread_messages_thread_sequence_uidx" ON "thread_messages" USING btree ("thread_id","sequence");
