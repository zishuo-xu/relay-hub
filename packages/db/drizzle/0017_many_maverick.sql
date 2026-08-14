ALTER TABLE "tasks" ADD COLUMN "collaboration_mode" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "collaborator_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;