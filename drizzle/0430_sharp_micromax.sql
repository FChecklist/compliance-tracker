CREATE TYPE "compliance"."construction_complaint_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "compliance"."construction_dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "compliance"."construction_customer_complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"customer_id" text,
	"category" text DEFAULT 'general' NOT NULL,
	"description" text NOT NULL,
	"severity" "compliance"."construction_complaint_severity" DEFAULT 'medium' NOT NULL,
	"status" "compliance"."construction_dispute_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"raised_by_id" text NOT NULL,
	"raised_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "compliance"."construction_vendor_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"vendor_id" text,
	"boq_line_item_id" text,
	"description" text NOT NULL,
	"amount_disputed" numeric,
	"status" "compliance"."construction_dispute_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"raised_by_id" text NOT NULL,
	"raised_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "compliance"."construction_boqs" ADD COLUMN "customer_approved_by_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_boqs" ADD COLUMN "customer_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."construction_boqs" ADD COLUMN "customer_esignature_request_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_change_orders" ADD COLUMN "boq_revision_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_interim_bills" ADD COLUMN "retention_released_amount" numeric;--> statement-breakpoint
ALTER TABLE "compliance"."construction_interim_bills" ADD COLUMN "retention_released_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."construction_interim_bills" ADD COLUMN "retention_released_by_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_labour_roster" ADD COLUMN "employee_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_work_progress_entries" ADD COLUMN "drawing_document_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_work_progress_entries" ADD COLUMN "drawing_confirmed_by_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_work_progress_entries" ADD COLUMN "drawing_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance"."erp_purchase_invoice_items" ADD COLUMN "boq_line_item_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."erp_purchase_order_items" ADD COLUMN "boq_line_item_id" text;