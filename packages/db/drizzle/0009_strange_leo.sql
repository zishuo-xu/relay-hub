ALTER TABLE "runs" ADD COLUMN "agent_profile_snapshot" jsonb;
--> statement-breakpoint
UPDATE "runs" AS "run"
SET "agent_profile_snapshot" = jsonb_strip_nulls(jsonb_build_object(
  'id', "agent"."id",
  'workspaceId', "agent"."workspace_id",
  'name', "agent"."name",
  'adapterType', "agent"."adapter_type",
  'provider', "agent"."provider",
  'modelLabel', "agent"."model_label",
  'modelFamily', "agent"."model_family",
  'capabilities', "agent"."capabilities",
  'config', "agent"."config",
  'enabled', "agent"."enabled"
))
FROM "agent_profiles" AS "agent"
WHERE "run"."agent_id" = "agent"."id";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "runs" WHERE "agent_profile_snapshot" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill Run AgentProfile snapshot';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "agent_profile_snapshot" SET NOT NULL;
