CREATE TYPE "compliance"."ingestion_batch_status" AS ENUM('processing', 'review_pending', 'confirmed', 'cancelled', 'failed');
--> statement-breakpoint
CREATE TYPE "compliance"."ingestion_item_status" AS ENUM('pending', 'approved', 'rejected', 'edited');
--> statement-breakpoint
CREATE TABLE "compliance"."ingestion_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size_bytes" integer,
	"file_url" text,
	"org_id" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"status" "compliance"."ingestion_batch_status" NOT NULL DEFAULT 'processing',
	"total_rows" integer,
	"extracted_count" integer,
	"approved_count" integer,
	"rejected_count" integer,
	"confirmed_count" integer,
	"ai_model" text,
	"extraction_summary" text,
	"error_message" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"confirmed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."ingestion_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_row" integer,
	"title" text,
	"compliance_type" text,
	"due_date" text,
	"status" text DEFAULT 'pending',
	"priority" text DEFAULT 'medium',
	"department_name" text,
	"department_id" text,
	"assigned_to_name" text,
	"assigned_to_id" text,
	"description" text,
	"extra_data" text,
	"confidence" text DEFAULT '0',
	"review_status" "compliance"."ingestion_item_status" NOT NULL DEFAULT 'pending',
	"warnings" text,
	"missing_fields" text,
	"is_duplicate" boolean DEFAULT false,
	"duplicate_of_id" text,
	"created_item_id" text,
	"created_at" timestamp NOT NULL DEFAULT now()
);
