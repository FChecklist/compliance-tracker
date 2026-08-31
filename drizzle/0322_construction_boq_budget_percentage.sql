ALTER TABLE "compliance"."construction_boq_line_items" ADD COLUMN "budget_percentage" numeric DEFAULT '25' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance"."construction_boq_line_items" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "compliance"."construction_boq_line_items" ADD COLUMN "vendor_amount" numeric;
