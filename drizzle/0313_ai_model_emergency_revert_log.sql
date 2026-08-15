CREATE TABLE "platform"."ai_model_emergency_revert_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"triggered_by_user_id" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
