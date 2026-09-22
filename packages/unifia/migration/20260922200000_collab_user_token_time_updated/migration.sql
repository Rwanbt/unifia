-- collab_user_token was created (20260406120000_collaborative_users) without
-- time_updated, but its Drizzle table spreads Timestamps, so every refresh
-- token insert (JwtAuth.issue, i.e. every collaborative login) failed with
-- "table collab_user_token has no column named time_updated".
-- SQLite rejects a non-constant default on ADD COLUMN, hence 0 then backfill.
ALTER TABLE "collab_user_token" ADD COLUMN "time_updated" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "collab_user_token" SET "time_updated" = "time_created";
