-- R46 P9 seq32 (R-43 G.10-G.17) -- THREE reuse-store tables, no more.
-- Deliberately NOT a "stored_functions" table: reuse of a function means
-- referencing a function_id already in the registry, never storing or
-- executing code from a row (v5 P-6/D-6, code-as-data is banned).
CREATE TYPE "compliance"."reuse_scope" AS ENUM ('user', 'organization', 'global');--> statement-breakpoint

CREATE TABLE "compliance"."reuse_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" "compliance"."reuse_scope" NOT NULL DEFAULT 'user',
	"input_hash" text NOT NULL,
	"function_id" text,
	"params" jsonb NOT NULL DEFAULT '{}',
	"response" jsonb,
	"reuse_count" integer NOT NULL DEFAULT 1,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
-- A lookup for the same (org, user, scope, input) must find at most one row --
-- this is what makes "second identical request -> reuse_count increments,
-- zero model calls" checkable at all, not just a hoped-for behaviour.
CREATE UNIQUE INDEX "reuse_cache_lookup_idx" ON "compliance"."reuse_cache" ("org_id","user_id","scope","input_hash");--> statement-breakpoint
CREATE INDEX "reuse_cache_org_idx" ON "compliance"."reuse_cache" ("org_id");--> statement-breakpoint

CREATE TABLE "compliance"."incident_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"error_type" text NOT NULL,
	"message" text NOT NULL,
	"file_path" text,
	"context" jsonb,
	"solution" text,
	"solved" boolean NOT NULL DEFAULT false,
	"solved_at" timestamp,
	"created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "incident_log_org_idx" ON "compliance"."incident_log" ("org_id");--> statement-breakpoint

CREATE TABLE "compliance"."memory_store" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "compliance"."reuse_scope" NOT NULL DEFAULT 'user',
	"org_id" text,
	"user_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"interactions" integer NOT NULL DEFAULT 1,
	"last_used" timestamp NOT NULL DEFAULT now(),
	"created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "memory_store_lookup_idx" ON "compliance"."memory_store" ("scope","org_id","user_id","key");--> statement-breakpoint

-- Reports/analyses reuse compliance.report_definitions -- NOT a parallel
-- table (G.10's "over-engineering, 8 tables -> 3" correction). Additive,
-- nullable column: the existing 218 rows are untouched.
ALTER TABLE "compliance"."report_definitions" ADD COLUMN "scope" "compliance"."reuse_scope";
