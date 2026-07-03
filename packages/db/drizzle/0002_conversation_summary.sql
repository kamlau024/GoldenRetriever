ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summary" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summary_embedding" vector(1536);
