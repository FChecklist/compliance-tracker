-- CRR-223 (PR #1398, rebase follow-up): adds the document_chunk.doc_uid
-- column and backfills it.
--
-- Root cause: commit 649f40e7 ("CRR-223: add doc_uid column to
-- documentChunk Drizzle schema") added `docUid` to the Drizzle model in
-- src/lib/db/schema.ts, and src/lib/crr/embed.ts's storeChunkEmbedding()
-- already does a raw-SQL INSERT that supplies doc_uid on every write --
-- but no migration ever shipped to add the column to the real database.
-- The schema.ts comment on documentChunk even names the migration it
-- expects ("crr223_doc_uid_storage_key") -- that file was never
-- committed. Left as-is, the very first insert through storeChunkEmbedding
-- would fail with "column document_chunk.doc_uid does not exist".
--
-- This migration adds the column nullable, backfills every pre-existing
-- row from its parent source_object's own permanent doc_uid (joining on
-- source_object_id, same denormalisation embed.ts relies on), then makes
-- it NOT NULL to match the Drizzle model.
ALTER TABLE "compliance"."document_chunk" ADD COLUMN "doc_uid" text;--> statement-breakpoint
UPDATE "compliance"."document_chunk" dc
SET "doc_uid" = so."doc_uid"
FROM "compliance"."source_object" so
WHERE so."id" = dc."source_object_id" AND dc."doc_uid" IS NULL;--> statement-breakpoint
ALTER TABLE "compliance"."document_chunk" ALTER COLUMN "doc_uid" SET NOT NULL;
