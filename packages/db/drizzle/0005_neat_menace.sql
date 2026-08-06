ALTER TABLE "runs" ADD COLUMN "execution_token_hash" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "token_revoked_at" timestamp with time zone;