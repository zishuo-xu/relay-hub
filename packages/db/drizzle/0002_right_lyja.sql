ALTER TABLE "runs" ADD COLUMN "workspace_root" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "worktree_path" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "working_directory" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "branch_name" text;