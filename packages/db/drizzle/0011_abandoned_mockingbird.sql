ALTER TABLE "handoffs" ADD COLUMN "bundle_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "risks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "next_action" jsonb;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "content_digest" text;