// Wave 11: generates an OpenAPI 3.1 document from the zod schemas in
// src/lib/schemas/*.ts using zod's built-in z.toJSONSchema() (zod v4) --
// OpenAPI 3.1's schema objects ARE JSON Schema, so no extra conversion
// package is needed. Wave 119 added the construction domain (PROJEXA's
// primary consumption surface) plus erp/budgets, erp/inventory (ledger/
// receipts/issues), erp/procurement (requisitions), documents, and
// pms/meetings + pms/time-entries -- the remaining ~30 domains are still
// not yet on /api/v1, intentionally absent here rather than faked.
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
import { createVendorSchema, createProjectBudgetSchema } from "@/lib/schemas/projexa-aliases"

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
        "The stable, versioned external contract for building on VERIDIAN AI -- a mobile app, ChatGPT Action, Claude connector, reseller white-label app, custom client integration, or a sibling product like PROJEXA (Construction Intelligence AI OS) all target this surface instead of the internal (app)/ UI's routes, which can change without notice. Covers compliance, tasks, notices, the full construction domain, erp/budgets, erp/inventory (ledger/receipts/issues), erp/procurement (requisitions), documents, and pms/meetings + pms/time-entries; the remaining ~30 GRC/ERP/PMS modules are not yet exposed here.",
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
          tags: ["PROJEXA"], summary: "Run one of the 17 named construction reports", operationId: "projexaReport",
          parameters: [
            { name: "reportName", in: "path", required: true, schema: { type: "string", enum: ["work-progress", "weekly-project", "project-status", "attendance", "site-picture", "scope", "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost", "manpower-cost", "designer-timesheet", "kpi", "revenue", "expense", "category-progress", "project-completion"] } },
            { name: "projectId", in: "query", required: true, schema: { type: "string" } },
            { name: "weekStart", in: "query", required: false, description: "Required only for the weekly-project report", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "400": { description: "Unknown report name or missing required param" } },
        },
      },
      "/projexa/ai/progress-summary": { get: { tags: ["PROJEXA"], summary: "AI-generated progress summary, grounded in real project numbers", operationId: "projexaAiProgressSummary", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/ai/risk-detection": { get: { tags: ["PROJEXA"], summary: "AI budget/schedule risk detection, grounded in real project numbers", operationId: "projexaAiRiskDetection", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
      "/projexa/ai/estimate-progress": { post: { tags: ["PROJEXA"], summary: "AI photo-based progress estimation for a logged activity", operationId: "projexaAiEstimateProgress", responses: { "200": { description: "OK" }, "400": { description: "Requires a real user session, not an API key" } } } },
    },
  }
}
