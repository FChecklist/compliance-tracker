// Wave 11: generates an OpenAPI 3.1 document from the zod schemas in
// src/lib/schemas/*.ts using zod's built-in z.toJSONSchema() (zod v4) --
// OpenAPI 3.1's schema objects ARE JSON Schema, so no extra conversion
// package is needed. Wave 119 added the construction domain (PROJEXA's
// primary consumption surface) plus erp/budgets, erp/inventory (ledger/
// receipts/issues), erp/procurement (requisitions), documents, and
// pms/meetings + pms/time-entries -- the remaining ~30 domains are still
// not yet on /api/v1, intentionally absent here rather than faked.
//
// AI Documentation gap-closure, 2026-08-07 (UMR-20260801-170930-2080
// sub-task, [Medium] AI-Readable API Documentation): added the 7 highest
// external-integration-value gaps identified by re-reading the real route
// files -- brain/capabilities + brain/entity-relationships (the new Brain
// namespace's first 2 real consumers), connectors/office-addin/whoami +
// /departments (the Office Add-in connector's own onboarding calls),
// platform/provision-org (service-to-service org provisioning, a sibling
// product's backend, not a customer's own key), and two already-partial
// paths that were missing their own sub-resource (tasks/{id}/status,
// construction/predictions/{activityId}). The remaining ~64 PROJEXA
// sub-resources (see `find src/app/api/v1/projexa -maxdepth 1 -type d`)
// are still not covered here -- real, multi-day work, tracked in
// ai-os/MASTER-TRACKER.yaml, prioritized finance cluster first per this
// same finding's own "external-integration demand" steer.
import { z } from "zod"
import {
  createComplianceItemSchema, updateComplianceItemSchema,
} from "@/lib/schemas/compliance"
import { createTaskSchema, updateTaskSchema } from "@/lib/schemas/tasks"
import { createNoticeSchema, updateNoticeSchema } from "@/lib/schemas/notices"
import {
  createBoqSchema, createBoqRevisionSchema, createProgressEntrySchema, createSiteDiarySchema,
  createRosterEntrySchema, recordAttendanceSchema, createKpiDefinitionSchema, submitKpiEntrySchema,
} from "@/lib/schemas/construction"
import {
  createBudgetSchema, recordStockReceiptSchema, recordStockIssueSchema,
  createPurchaseRequisitionSchema, createMeetingSchema, logTimeSchema,
} from "@/lib/schemas/erp-pms-v1"
import { createVendorSchema, createProjectBudgetSchema, assistantQuerySchema, diffDrawingsSchema } from "@/lib/schemas/projexa-aliases"

function toSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-2020-12" })
}

const bearerAuth = {
  type: "http" as const,
  scheme: "bearer" as const,
  bearerFormat: "vk_...",
  description: "Generate a key via Settings > API Keys. The same key works for /api/v1/* and MCP (/api/mcp).",
}

export function generateOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "VERIDIAN AI — Platform API",
      version: "1.0.0",
      description:
        "The stable, versioned external contract for building on VERIDIAN AI -- a mobile app, ChatGPT Action, Claude connector, reseller white-label app, custom client integration, or a sibling product like PROJEXA (Construction Intelligence AI OS) all target this surface instead of the internal (app)/ UI's routes, which can change without notice. Covers compliance, tasks, notices, the full construction domain, erp/budgets, erp/inventory (ledger/receipts/issues), erp/procurement (requisitions), documents, reports (the Reports & Analysis Engine's report_definitions catalog + generic execution dispatcher), pms/meetings + pms/time-entries, the Brain namespace (capabilities search, entity relationships), the Office Add-in connector (whoami, departments), and platform-level org provisioning (service-to-service only, not a customer key); the remaining ~30 GRC/ERP/PMS modules plus ~64 PROJEXA sub-resources are not yet exposed here. Change history: docs/API_CHANGELOG.md. Testing safely before using a real org: docs/API_SANDBOX.md (no dedicated sandbox environment exists yet -- that doc is honest about the interim state). Rate limiting: each API key has its own configurable requests-per-minute cap, unlimited by default -- see docs/API_RATE_LIMITS.md in the repo for the full default/available values and how a 429 is returned.",
    },
    servers: [{ url: "https://veridian-compliance-ai.vercel.app/api/v1" }],
    // Wave 124: every /projexa/* path is tagged "PROJEXA" so an external
    // integrator building on that namespace sees one coherent construction-
    // domain surface, distinct from the generic /erp, /pms, and
    // /construction paths the same underlying data is also reachable
    // through (the /projexa/* routes are thin aliases over those, not a
    // separate implementation -- see each route file's own header comment).
    tags: [{ name: "PROJEXA", description: "Construction-domain-friendly aliases for PROJEXA (Construction Intelligence AI OS) and other construction-vertical integrators. Thin wrappers over the generic erp/pms/construction services -- same data, construction-friendly field names and URL paths." }],
    components: {
      securitySchemes: { bearerAuth },
      schemas: {
        CreateComplianceItem: toSchema(createComplianceItemSchema),
        UpdateComplianceItem: toSchema(updateComplianceItemSchema),
        CreateTask: toSchema(createTaskSchema),
        UpdateTask: toSchema(updateTaskSchema),
        CreateNotice: toSchema(createNoticeSchema),
        UpdateNotice: toSchema(updateNoticeSchema),
        CreateBoq: toSchema(createBoqSchema),
        CreateBoqRevision: toSchema(createBoqRevisionSchema),
        CreateProgressEntry: toSchema(createProgressEntrySchema),
        CreateSiteDiary: toSchema(createSiteDiarySchema),
        CreateRosterEntry: toSchema(createRosterEntrySchema),
        RecordAttendance: toSchema(recordAttendanceSchema),
        CreateKpiDefinition: toSchema(createKpiDefinitionSchema),
        SubmitKpiEntry: toSchema(submitKpiEntrySchema),
        CreateBudget: toSchema(createBudgetSchema),
        RecordStockReceipt: toSchema(recordStockReceiptSchema),
        RecordStockIssue: toSchema(recordStockIssueSchema),
        CreatePurchaseRequisition: toSchema(createPurchaseRequisitionSchema),
        CreateMeeting: toSchema(createMeetingSchema),
        LogTime: toSchema(logTimeSchema),
        CreateVendor: toSchema(createVendorSchema),
        CreateProjectBudget: toSchema(createProjectBudgetSchema),
        AssistantQuery: toSchema(assistantQuerySchema),
        DiffDrawings: toSchema(diffDrawingsSchema),
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/compliance": {
        get: { summary: "List compliance items", operationId: "listComplianceItems", responses: { "200": { description: "OK" } } },
        post: {
          summary: "Create a compliance item", operationId: "createComplianceItem",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateComplianceItem" } } } },
          responses: { "201": { description: "Created" }, "400": { description: "Validation error" } },
        },
      },
      "/compliance/{id}": {
        get: { summary: "Get a compliance item", operationId: "getComplianceItem", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
        patch: {
          summary: "Update a compliance item", operationId: "updateComplianceItem",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateComplianceItem" } } } },
          responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
        },
        delete: { summary: "Delete a compliance item", operationId: "deleteComplianceItem", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      },
      "/compliance/stats": { get: { summary: "Compliance dashboard stats", operationId: "getComplianceStats", responses: { "200": { description: "OK" } } } },
      "/tasks": {
        get: { summary: "List tasks", operationId: "listTasks", responses: { "200": { description: "OK" } } },
        post: {
          summary: "Create a task (dispatches the task-execution engine)", operationId: "createTask",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTask" } } } },
          responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } },
        },
      },
      "/tasks/{id}": {
        get: { summary: "Get a task, including its execution plan and chat", operationId: "getTask", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
        patch: {
          summary: "Update a task", operationId: "updateTask",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTask" } } } },
          responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
        },
      },
      "/tasks/{id}/status": {
        get: {
          summary: "Lightweight status-only read (distinct from GET /tasks/{id}, which also returns the execution plan + chat) -- what the MCP get_task_status tool calls",
          operationId: "getTaskStatus", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
        },
      },
      "/notices": {
        get: { summary: "List notices", operationId: "listNotices", responses: { "200": { description: "OK" } } },
        post: {
          summary: "Create a notice", operationId: "createNotice",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateNotice" } } } },
          responses: { "201": { description: "Created" }, "400": { description: "Validation error" } },
        },
      },
      "/notices/{id}": {
        get: { summary: "Get a notice", operationId: "getNotice", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
        patch: {
          summary: "Update a notice", operationId: "updateNotice",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateNotice" } } } },
          responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
        },
        delete: { summary: "Delete a notice", operationId: "deleteNotice", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      },
      "/notices/stats": { get: { summary: "Notice dashboard stats", operationId: "getNoticeStats", responses: { "200": { description: "OK" } } } },

      // ─── task-20260727-101145: external-AI-facing reporting gateway ───
      // Reports & Analysis Engine's ~200-row report_definitions catalog +
      // generic execution dispatcher, exposed for a customer's own AI,
      // ChatGPT/z.ai, or a reseller app -- authenticate with a `read` or
      // `read:reports`-scoped key (Settings > API Keys).
      "/reports/catalog": {
        get: {
          summary: "List available reports for the caller's org (org-scoped rows + platform-wide catalog)",
          operationId: "listReportsCatalogV1",
          responses: { "200": { description: "OK" } },
        },
      },
      "/reports/definitions/{id}/run": {
        post: {
          summary: "Run a report definition and return its result as structured JSON (default) or a CSV/Excel file download",
          operationId: "runReportDefinitionV1",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "format", in: "query", required: false, description: "json (default), csv, or xlsx/excel", schema: { type: "string", enum: ["json", "csv", "xlsx", "excel"] } },
          ],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { params: { type: "object" } } } } } },
          responses: { "200": { description: "OK -- JSON result, or a CSV/XLSX file when ?format= is set" }, "404": { description: "Report definition not found (including: exists, but not visible to this org)" } },
        },
      },

      // ─── Wave 119: Construction (PROJEXA) ──────────────────────────────
      "/construction/boq": {
        get: { summary: "List BOQs for a project", operationId: "listBoqs", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Create a BOQ", operationId: "createBoq", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateBoq" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/construction/boq/{id}": { get: { summary: "Get a BOQ with line items", operationId: "getBoq", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } } },
      "/construction/boq/{id}/revisions": { post: { summary: "Create a new BOQ revision", operationId: "createBoqRevision", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateBoqRevision" } } } }, responses: { "201": { description: "Created" } } } },
      "/construction/boq/{id}/compare": { get: { summary: "Compare a BOQ revision against its parent", operationId: "compareBoq", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "400": { description: "No previous revision" } } } },
      "/construction/progress": {
        get: { summary: "List work progress entries", operationId: "listProgressEntries", responses: { "200": { description: "OK" } } },
        post: { summary: "Log a daily progress entry", operationId: "createProgressEntry", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProgressEntry" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/construction/site-diary": {
        get: { summary: "List site diary entries for a project", operationId: "listSiteDiaries", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Create a daily site diary entry", operationId: "createSiteDiary", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateSiteDiary" } } } }, responses: { "201": { description: "Created" }, "409": { description: "Already recorded for this project/date" } } },
      },
      "/construction/labour-roster": {
        get: { summary: "List labour roster for a project", operationId: "listRoster", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Add a labour roster entry", operationId: "createRosterEntry", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRosterEntry" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/construction/attendance": {
        get: { summary: "List attendance records", operationId: "listAttendance", responses: { "200": { description: "OK" } } },
        post: { summary: "Record daily attendance", operationId: "recordAttendance", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RecordAttendance" } } } }, responses: { "201": { description: "Created" }, "409": { description: "Already recorded" } } },
      },
      "/construction/kpi-definitions": {
        get: { summary: "List KPI definitions", operationId: "listKpiDefinitions", responses: { "200": { description: "OK" } } },
        post: { summary: "Create a KPI definition", operationId: "createKpiDefinition", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateKpiDefinition" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/construction/kpi-entries": {
        get: { summary: "List entries for a KPI definition", operationId: "listKpiEntries", parameters: [{ name: "kpiDefinitionId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Submit a KPI entry (designer fills)", operationId: "submitKpiEntry", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SubmitKpiEntry" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/construction/kpi-entries/{id}/approve": { post: { summary: "Approve a submitted KPI entry (manager approves)", operationId: "approveKpiEntry", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "403": { description: "Submitter cannot self-approve" } } } },
      "/construction/predictions/{activityId}": {
        get: {
          summary: "Deterministic predicted completion date for an activity (velocity-based, no AI) -- same underlying prediction as /projexa/predictions/{activityId}", operationId: "predictActivityCompletion",
          parameters: [{ name: "activityId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
        },
      },

      // ─── AI Documentation gap-closure, 2026-08-07: Brain namespace ─────
      // (Wave 153 groundwork -- thin wrappers over existing services, no
      // new data model, no code moved -- see each route's own header.)
      "/brain/capabilities": {
        get: {
          summary: "Embedding-similarity search over the capability registry (Chain Selector leaves) for a free-text query", operationId: "brainCapabilitiesSearch",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, description: "Default 10, capped at 25", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "OK" }, "400": { description: "query is required" } },
        },
      },
      "/brain/entity-relationships": {
        get: {
          summary: "Real, live-computed neighbor list for an entity in the platform's entity graph (entity-graph-service.ts)", operationId: "brainEntityRelationships",
          parameters: [
            { name: "entityType", in: "query", required: true, schema: { type: "string" } },
            { name: "entityId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "400": { description: "entityType and entityId are required" } },
        },
      },

      // ─── AI Documentation gap-closure, 2026-08-07: Office Add-in connector ───
      "/connectors/office-addin/whoami": {
        get: {
          summary: "Confirms the caller's vk_... API key is valid and returns which org/key it resolves to -- what the Office Add-in task pane calls right after a user pastes in their key", operationId: "connectorsOfficeAddinWhoami",
          responses: { "200": { description: "OK" }, "400": { description: "No organisation on this account" } },
        },
      },
      "/connectors/office-addin/departments": {
        get: {
          summary: "Minimal id/name department list for the Office Add-in's 'Create compliance item' form dropdown -- deliberately narrower than the internal (session-only) /api/departments route", operationId: "connectorsOfficeAddinDepartments",
          responses: { "200": { description: "OK" } },
        },
      },

      // ─── AI Documentation gap-closure, 2026-08-07: Platform provisioning ───
      "/platform/provision-org": {
        post: {
          summary: "Service-to-service tenant provisioning -- a sibling product's own BACKEND (e.g. PROJEXA) calls this at ITS OWN signup time to provision a fresh, isolated VERIDIAN org for one of its customers. Authenticated ONLY by a platform_applications bearer token (Authorization: Bearer pk_...), NOT a customer vk_... API key -- this endpoint is not reachable with the bearerAuth scheme documented above.",
          operationId: "platformProvisionOrg",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["customerOrgName"], properties: {
              customerOrgName: { type: "string" },
              country: { type: "string", description: "Defaults to IN" },
              primaryCurrency: { type: "string", description: "Defaults to INR" },
            } } } },
          },
          responses: { "200": { description: "OK -- new org provisioned" }, "401": { description: "Invalid/missing platform application token" }, "400": { description: "customerOrgName is required" } },
        },
      },

      // ─── Wave 119: existing ERP/PMS/Documents modules ──────────────────
      "/erp/budgets": {
        get: { summary: "List budgets", operationId: "listBudgets", responses: { "200": { description: "OK" } } },
        post: { summary: "Create a budget", operationId: "createBudget", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateBudget" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/erp/budgets/{id}": { get: { summary: "Get a budget with line items", operationId: "getBudget", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } } },
      "/erp/inventory/ledger": { get: { summary: "List stock ledger entries", operationId: "listStockLedger", responses: { "200": { description: "OK" } } } },
      "/erp/inventory/receipts": { post: { summary: "Record a stock receipt (opens a FIFO layer)", operationId: "recordStockReceipt", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RecordStockReceipt" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/erp/inventory/issues": { post: { summary: "Record a stock issue (consumes FIFO layers oldest-first)", operationId: "recordStockIssue", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RecordStockIssue" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/erp/procurement/requisitions": {
        get: { summary: "List purchase requisitions", operationId: "listPurchaseRequisitions", responses: { "200": { description: "OK" } } },
        post: { summary: "Create a purchase requisition", operationId: "createPurchaseRequisition", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePurchaseRequisition" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } } },
      },
      "/documents": { get: { summary: "List documents (drawings/permits/site photos are documents with a category)", operationId: "listDocumentsV1", responses: { "200": { description: "OK" } } } },
      "/documents/expiring": { get: { summary: "List documents expiring soon (permit-expiry reminders use category=permit)", operationId: "listExpiringDocumentsV1", parameters: [{ name: "category", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/pms/meetings": {
        get: { summary: "List meetings for a project", operationId: "listMeetings", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Create a meeting", operationId: "createMeeting", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateMeeting" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } } },
      },
      "/pms/time-entries": {
        get: { summary: "List time entries for a project or issue", operationId: "listTimeEntries", responses: { "200": { description: "OK" } } },
        post: { summary: "Log a time entry", operationId: "logTime", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LogTime" } } } }, responses: { "201": { description: "Created" }, "400": { description: "Requires a real user session, not an API key" } } },
      },

      // ─── Wave 124: PROJEXA aliasing namespace (all tagged "PROJEXA") ───
      "/projexa/vendors": {
        get: { tags: ["PROJEXA"], summary: "List vendors (alias of erp_suppliers)", operationId: "projexaListVendors", responses: { "200": { description: "OK" } } },
        post: { tags: ["PROJEXA"], summary: "Create a vendor", operationId: "projexaCreateVendor", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateVendor" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/projexa/project-budgets": {
        get: { tags: ["PROJEXA"], summary: "List project budgets (alias of erp_budgets)", operationId: "projexaListProjectBudgets", responses: { "200": { description: "OK" } } },
        post: { tags: ["PROJEXA"], summary: "Create a project budget", operationId: "projexaCreateProjectBudget", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProjectBudget" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/projexa/materials": { get: { tags: ["PROJEXA"], summary: "List material stock ledger entries (alias of erp_stock_ledger_entries)", operationId: "projexaListMaterials", parameters: [{ name: "materialId", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/projexa/expenses": {
        get: { tags: ["PROJEXA"], summary: "List project expense entries", operationId: "projexaListExpenses", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
        post: { tags: ["PROJEXA"], summary: "Record a project expense entry", operationId: "projexaCreateExpense", responses: { "201": { description: "Created" } } },
      },
      "/projexa/scope": { get: { tags: ["PROJEXA"], summary: "List BOQs (alias of /construction/boq)", operationId: "projexaListScope", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Create a BOQ", operationId: "projexaCreateScope", responses: { "201": { description: "Created" } } } },
      "/projexa/work-progress": { get: { tags: ["PROJEXA"], summary: "List work progress entries (alias of /construction/progress)", operationId: "projexaListWorkProgress", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Log a progress entry", operationId: "projexaCreateWorkProgress", responses: { "201": { description: "Created" } } } },
      "/projexa/site-diary": { get: { tags: ["PROJEXA"], summary: "List site diary entries (alias of /construction/site-diary)", operationId: "projexaListSiteDiary", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Create a site diary entry", operationId: "projexaCreateSiteDiary", responses: { "201": { description: "Created" } } } },
      "/projexa/labour": { get: { tags: ["PROJEXA"], summary: "List labour roster (alias of /construction/labour-roster)", operationId: "projexaListLabour", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Add a labour roster entry", operationId: "projexaCreateLabour", responses: { "201": { description: "Created" } } } },
      "/projexa/attendance": { get: { tags: ["PROJEXA"], summary: "List attendance (alias of /construction/attendance)", operationId: "projexaListAttendance", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Record attendance", operationId: "projexaRecordAttendance", responses: { "201": { description: "Created" } } } },
      "/projexa/kpis": { get: { tags: ["PROJEXA"], summary: "List KPI definitions (alias of /construction/kpi-definitions)", operationId: "projexaListKpis", responses: { "200": { description: "OK" } } }, post: { tags: ["PROJEXA"], summary: "Create a KPI definition", operationId: "projexaCreateKpi", responses: { "201": { description: "Created" } } } },
      "/projexa/dashboard": { get: { tags: ["PROJEXA"], summary: "Company/department drill-down dashboard", operationId: "projexaOrgDashboard", parameters: [{ name: "departmentId", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/projexa/dashboard/{projectId}": { get: { tags: ["PROJEXA"], summary: "Project dashboard (budget/revenue/expenses/progress/delay/photos/tasks)", operationId: "projexaProjectDashboard", parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/projexa/reports/{reportName}": {
        get: {
          tags: ["PROJEXA"],
          summary: "Run one of the 17 named construction reports",
          description:
            "Answers with the generic table contract { columns, rows, totals?, currency, note? }. " +
            "Before 2026-09-03 this returned each report handler's own payload; that shape is still " +
            "available for one release via ?format=legacy and is scheduled for removal — migrate to the " +
            "table columns.",
          operationId: "projexaReport",
          parameters: [
            { name: "reportName", in: "path", required: true, schema: { type: "string", enum: ["work-progress", "weekly-project", "project-status", "attendance", "site-picture", "scope", "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost", "manpower-cost", "designer-timesheet", "kpi", "revenue", "expense", "category-progress", "project-completion"] } },
            { name: "projectId", in: "query", required: true, schema: { type: "string" } },
            { name: "weekStart", in: "query", required: false, description: "Required only for the weekly-project report", schema: { type: "string" } },
            // R67 E-32: the escape hatch has to be VISIBLE on the published
            // contract, or an external caller has no way to discover that the
            // shape they were reading still exists.
            { name: "format", in: "query", required: false, description: "Pass \"legacy\" to receive the pre-2026-09-03 per-report payload instead of the table contract. Deprecated; supported for one release.", schema: { type: "string", enum: ["legacy"] } },
          ],
          responses: { "200": { description: "OK" }, "400": { description: "Unknown report name or missing required param" } },
        },
      },
      // R67 E-33: portfolio-wide, so deliberately two segments deep -- a static
      // "budget-vs-actual" sibling of {reportName} would shadow the per-project
      // report of that name.
      "/projexa/reports/portfolio/budget-vs-actual": {
        get: {
          tags: ["PROJEXA"],
          summary: "Revenue, budget and earned value per project across the portfolio",
          description: "Answers in the same { columns, rows, totals?, currency } table contract as /projexa/reports/{reportName}. Manager role or higher.",
          operationId: "projexaPortfolioBudgetVsActual",
          parameters: [
            { name: "departmentId", in: "query", required: false, schema: { type: "string" } },
            { name: "from", in: "query", required: false, description: "Revenue/expense window (YYYY-MM-DD). The BOQ-derived budget is not date-filtered.", schema: { type: "string" } },
            { name: "to", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "403": { description: "Requires manager role or higher" } },
        },
      },
      // R67 E-28: binary. PROJEXA relays this rather than gaining a spreadsheet
      // library of its own.
      "/projexa/work-progress/report/xlsx": {
        get: {
          tags: ["PROJEXA"],
          summary: "Work Progress Report as an .xlsx workbook",
          description: "Same rows and same arithmetic as the JSON report and the PDF. Returns application/vnd.openxmlformats-officedocument.spreadsheetml.sheet with a Content-Disposition naming the project and the period.",
          operationId: "projexaWorkProgressReportXlsx",
          parameters: [
            { name: "projectId", in: "query", required: true, schema: { type: "string" } },
            { name: "from", in: "query", required: true, description: "YYYY-MM-DD", schema: { type: "string" } },
            { name: "to", in: "query", required: true, description: "YYYY-MM-DD", schema: { type: "string" } },
            { name: "mode", in: "query", required: false, description: "Third column reading: cumulative total (default) or remaining balance.", schema: { type: "string", enum: ["total", "balance"] } },
          ],
          responses: { "200": { description: "OK" }, "400": { description: "Missing projectId, from or to" }, "404": { description: "Project not found" } },
        },
      },
      "/projexa/ai/progress-summary": { get: { tags: ["PROJEXA"], summary: "AI-generated progress summary, grounded in real project numbers", operationId: "projexaAiProgressSummary", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/ai/risk-detection": { get: { tags: ["PROJEXA"], summary: "AI budget/schedule risk detection, grounded in real project numbers", operationId: "projexaAiRiskDetection", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/ai/estimate-progress": { post: { tags: ["PROJEXA"], summary: "AI photo-based progress estimation for a logged activity", operationId: "projexaAiEstimateProgress", responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/predictions/{activityId}": { get: { tags: ["PROJEXA"], summary: "Deterministic predicted completion date for an activity (velocity-based, no AI)", operationId: "projexaPredictCompletion", parameters: [{ name: "activityId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/projexa/ai/diff-drawings": { post: { tags: ["PROJEXA"], summary: "AI diff between two drawing revision images", operationId: "projexaDiffDrawings", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DiffDrawings" } } } }, responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/assistant": {
        post: {
          tags: ["PROJEXA"], summary: "Structured construction data assistant -- dispatches one of the 7 registered construction worker agents by codeReference", operationId: "projexaAssistant",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssistantQuery" } } } },
          responses: { "200": { description: "OK" }, "400": { description: "Unknown codeReference or missing required input" } },
        },
      },
    },
  }
}
