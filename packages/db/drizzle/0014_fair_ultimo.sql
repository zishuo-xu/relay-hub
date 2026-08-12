CREATE TABLE "message_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_message_id_thread_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."thread_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_agent_id_agent_profiles_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "message_dispatches" ("message_id", "task_id", "agent_id", "created_at")
SELECT
	"thread_messages"."id",
	"thread_messages"."task_id",
	COALESCE("thread_messages"."recipient_agent_id", "tasks"."builder_agent_id"),
	"thread_messages"."created_at"
FROM "thread_messages"
INNER JOIN "tasks" ON "tasks"."id" = "thread_messages"."task_id"
WHERE
	"thread_messages"."sender_type" = 'user'
	AND "thread_messages"."task_id" IS NOT NULL
	AND COALESCE("thread_messages"."recipient_agent_id", "tasks"."builder_agent_id") IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "message_dispatches_message_agent_uidx" ON "message_dispatches" USING btree ("message_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_dispatches_task_uidx" ON "message_dispatches" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "message_dispatches_message_idx" ON "message_dispatches" USING btree ("message_id");
