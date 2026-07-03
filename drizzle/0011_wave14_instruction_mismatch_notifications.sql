-- Wave 14: instruction mismatches reach the user proactively (notifications).
-- Two independent, additive changes applied as separate statements against
-- Supabase (matching Wave 1's enum-extension precedent -- ALTER TYPE ADD
-- VALUE is not combined into a larger multi-statement transaction here):

-- 1. New notification type for the instruction-mismatch-audit loop to use.
ALTER TYPE compliance.notification_type ADD VALUE IF NOT EXISTS 'instruction_mismatch';

-- 2. Generic type-specific payload column -- lets the topbar's click-through
-- route to the right place per notification type (e.g. instruction_mismatch
-- needs conversationId+mismatchId to open the exact chat thread) without a
-- bespoke FK column per notification type.
ALTER TABLE compliance.notifications ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
