import { describe, it, expect } from "vitest";
import {
  CreateComplianceSchema,
  ChangeStatusSchema,
  ReassignSchema,
  BulkStatusChangeSchema,
  ComplianceFiltersSchema,
  InviteUserSchema,
  CreateOrganisationSchema,
  CreateCommentSchema,
  CreateSalesAgentSchema,
  NotificationPreferencesSchema,
} from "@compliancetrack/types";

describe("CreateComplianceSchema", () => {
  const valid = {
    org_id: "550e8400-e29b-41d4-a716-446655440000",
    department_id: null,
    title: "Annual IT Compliance Review",
    description: "Review all IT compliance requirements for the fiscal year.",
    compliance_type: "it" as const,
    priority: "high" as const,
    assignee_id: null,
    due_date: null,
    metadata: {},
  };

  it("accepts valid input", () => {
    expect(CreateComplianceSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = CreateComplianceSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title exceeding 500 chars", () => {
    const result = CreateComplianceSchema.safeParse({ ...valid, title: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid compliance_type", () => {
    const result = CreateComplianceSchema.safeParse({ ...valid, compliance_type: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = CreateComplianceSchema.safeParse({ ...valid, priority: "urgent" });
    expect(result.success).toBe(false);
  });

  it("accepts optional due_date as ISO string", () => {
    const result = CreateComplianceSchema.safeParse({
      ...valid,
      due_date: "2026-12-31T23:59:59.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID org_id", () => {
    const result = CreateComplianceSchema.safeParse({ ...valid, org_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("ChangeStatusSchema", () => {
  it("accepts valid status change", () => {
    const result = ChangeStatusSchema.safeParse({ new_status: "in_progress" });
    expect(result.success).toBe(true);
  });

  it("accepts status change with reason", () => {
    const result = ChangeStatusSchema.safeParse({
      new_status: "completed",
      reason: "All requirements verified and documented.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = ChangeStatusSchema.safeParse({ new_status: "not_real" });
    expect(result.success).toBe(false);
  });

  it("rejects empty reason when provided", () => {
    const result = ChangeStatusSchema.safeParse({ new_status: "in_progress", reason: "" });
    expect(result.success).toBe(false);
  });

  it("rejects reason exceeding 1000 chars", () => {
    const result = ChangeStatusSchema.safeParse({ new_status: "in_progress", reason: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe("ReassignSchema", () => {
  it("accepts valid reassignment", () => {
    const result = ReassignSchema.safeParse({
      assignee_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID assignee_id", () => {
    const result = ReassignSchema.safeParse({ assignee_id: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts optional reason", () => {
    const result = ReassignSchema.safeParse({
      assignee_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "Reassigned to domain expert",
    });
    expect(result.success).toBe(true);
  });
});

describe("BulkStatusChangeSchema", () => {
  it("accepts valid bulk change", () => {
    const result = BulkStatusChangeSchema.safeParse({
      compliance_ids: ["550e8400-e29b-41d4-a716-446655440000"],
      new_status: "completed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty compliance_ids array", () => {
    const result = BulkStatusChangeSchema.safeParse({
      compliance_ids: [],
      new_status: "completed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 100 IDs", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}`);
    const result = BulkStatusChangeSchema.safeParse({ compliance_ids: ids, new_status: "completed" });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID in the array", () => {
    const result = BulkStatusChangeSchema.safeParse({
      compliance_ids: ["not-a-uuid"],
      new_status: "completed",
    });
    expect(result.success).toBe(false);
  });
});

describe("ComplianceFiltersSchema", () => {
  it("accepts empty filters (all defaults)", () => {
    const result = ComplianceFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.per_page).toBe(25);
      expect(result.data.sort_by).toBe("due_date");
      expect(result.data.sort_order).toBe("asc");
    }
  });

  it("accepts full filter set", () => {
    const result = ComplianceFiltersSchema.safeParse({
      status: "pending",
      priority: "high",
      compliance_type: "tax",
      search: "annual review",
      page: 2,
      per_page: 50,
      sort_by: "priority",
      sort_order: "desc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid sort_by", () => {
    const result = ComplianceFiltersSchema.safeParse({ sort_by: "nonexistent" });
    expect(result.success).toBe(false);
  });

  it("rejects page below 1", () => {
    const result = ComplianceFiltersSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects per_page above 100", () => {
    const result = ComplianceFiltersSchema.safeParse({ per_page: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum", () => {
    const result = ComplianceFiltersSchema.safeParse({ status: "invalid_status" });
    expect(result.success).toBe(false);
  });
});

describe("InviteUserSchema", () => {
  it("rejects invalid email", () => {
    const result = InviteUserSchema.safeParse({ email: "not-email", full_name: "Test", role: "viewer" as const });
    expect(result.success).toBe(false);
  });

  it("rejects empty full_name", () => {
    const result = InviteUserSchema.safeParse({ email: "a@b.com", full_name: "", role: "viewer" as const });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = InviteUserSchema.safeParse({ email: "a@b.com", full_name: "Test", role: "superadmin" });
    expect(result.success).toBe(false);
  });
});

describe("CreateOrganisationSchema", () => {
  const valid = {
    name: "Acme Corp",
    slug: "acme-corp",
    plan_type: "single_entity" as const,
    owner_id: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("accepts valid organisation", () => {
    const result = CreateOrganisationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateOrganisationSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 255 chars", () => {
    const result = CreateOrganisationSchema.safeParse({ ...valid, name: "x".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slug format", () => {
    const result = CreateOrganisationSchema.safeParse({ ...valid, slug: "Invalid Slug!" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid plan_type", () => {
    const result = CreateOrganisationSchema.safeParse({ ...valid, plan_type: "enterprise" });
    expect(result.success).toBe(false);
  });
});

describe("CreateCommentSchema", () => {
  it("accepts valid comment", () => {
    const result = CreateCommentSchema.safeParse({
      compliance_id: "550e8400-e29b-41d4-a716-446655440000",
      body: "This needs review by legal.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts comment with parent_comment_id", () => {
    const result = CreateCommentSchema.safeParse({
      compliance_id: "550e8400-e29b-41d4-a716-446655440000",
      parent_comment_id: "550e8400-e29b-41d4-a716-446655440001",
      body: "Reply to above.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty body", () => {
    const result = CreateCommentSchema.safeParse({
      compliance_id: "550e8400-e29b-41d4-a716-446655440000",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID compliance_id", () => {
    const result = CreateCommentSchema.safeParse({ compliance_id: "bad", body: "ok" });
    expect(result.success).toBe(false);
  });

  it("rejects body exceeding 10000 chars", () => {
    const result = CreateCommentSchema.safeParse({ compliance_id: "550e8400-e29b-41d4-a716-446655440000", body: "x".repeat(10001) });
    expect(result.success).toBe(false);
  });
});

describe("CreateSalesAgentSchema", () => {
  it("accepts valid agent", () => {
    const result = CreateSalesAgentSchema.safeParse({
      name: "Jane Agent",
      email: "jane@sales.com",
      commission_rate: 10,
    });
    expect(result.success).toBe(true);
  });

  it("accepts agent with optional phone", () => {
    const result = CreateSalesAgentSchema.safeParse({
      name: "Jane Agent",
      email: "jane@sales.com",
      phone: "+919876543210",
      commission_rate: 15.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = CreateSalesAgentSchema.safeParse({ name: "A", email: "bad", commission_rate: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateSalesAgentSchema.safeParse({ name: "", email: "a@b.com", commission_rate: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects commission_rate above 100", () => {
    const result = CreateSalesAgentSchema.safeParse({ name: "A", email: "a@b.com", commission_rate: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects commission_rate below 0", () => {
    const result = CreateSalesAgentSchema.safeParse({ name: "A", email: "a@b.com", commission_rate: -1 });
    expect(result.success).toBe(false);
  });
});

describe("NotificationPreferencesSchema", () => {
  it("accepts valid preferences", () => {
    const result = NotificationPreferencesSchema.safeParse({
      email_deadline_reminder: true,
      push_overdue: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial input (all fields have defaults)", () => {
    const result = NotificationPreferencesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email_deadline_reminder).toBe(true);
      expect(result.data.push_assignment).toBe(true);
    }
  });

  it("rejects non-boolean values", () => {
    const result = NotificationPreferencesSchema.safeParse({ email_deadline_reminder: "yes" });
    expect(result.success).toBe(false);
  });
});