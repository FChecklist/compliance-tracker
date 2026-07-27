CREATE TABLE "compliance"."crm_sales_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"month" date NOT NULL,
	"target_value" numeric NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
