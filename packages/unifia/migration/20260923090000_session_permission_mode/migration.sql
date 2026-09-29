-- The composer's accept mode (ask / auto-edit / full-auto), which tightens the
-- agent's permission rules at ask time (ADR-043). NULL = no mode sent, rules
-- apply unchanged, as before this column existed.
ALTER TABLE "session" ADD COLUMN "permission_mode" text;
