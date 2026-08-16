CREATE SCHEMA "compliance";
--> statement-breakpoint
CREATE TYPE "compliance"."audit_action" AS ENUM('create', 'update', 'delete', 'status_change', 'assign', 'reassign', 'login', 'logout', 'export', 'invite');--> statement-breakpoint
CREATE TYPE "compliance"."compliance_status" AS ENUM('pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft');--> statement-breakpoint
CREATE TYPE "compliance"."compliance_type" AS ENUM('GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "compliance"."notification_type" AS ENUM('deadline_reminder', 'assignment', 'status_change', 'comment', 'system', 'mention');--> statement-breakpoint
CREATE TYPE "compliance"."priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "compliance"."user_role" AS ENUM('admin', 'manager', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "compliance"."audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"action" "compliance"."audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"details" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."audit_points" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "compliance"."compliance_status" DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"completed_at" timestamp,
	"compliance_item_id" text NOT NULL,
	"assigned_to_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."comments" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text DEFAULT 'compliance' NOT NULL,
	"author_id" text NOT NULL,
	"compliance_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."compliance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"compliance_type" "compliance"."compliance_type" NOT NULL,
	"status" "compliance"."compliance_status" DEFAULT 'pending' NOT NULL,
	"priority" "compliance"."priority" DEFAULT 'medium' NOT NULL,
	"due_date" timestamp NOT NULL,
	"completed_at" timestamp,
	"department_id" text NOT NULL,
	"assigned_to_id" text,
	"org_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"org_id" text NOT NULL,
	"head_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_head_id_unique" UNIQUE("head_id")
);
--> statement-breakpoint
CREATE TABLE "compliance"."documents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"compliance_item_id" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" "compliance"."notification_type" DEFAULT 'system' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."organisations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "compliance"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "compliance"."user_role" DEFAULT 'member' NOT NULL,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"org_id" text,
	"department_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
