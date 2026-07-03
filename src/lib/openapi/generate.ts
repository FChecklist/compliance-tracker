// Wave 11: generates an OpenAPI 3.1 document from the zod schemas in
// src/lib/schemas/*.ts using zod's built-in z.toJSONSchema() (zod v4) --
// OpenAPI 3.1's schema objects ARE JSON Schema, so no extra conversion
// package is needed. Covers the 3 domains serviced this wave (compliance,
// tasks, notices) -- the other ~37 domains are not yet on /api/v1, so
// they're intentionally absent here rather than faked.
import { z } from "zod"
import {
  createComplianceItemSchema, updateComplianceItemSchema,
} from "@/lib/schemas/compliance"
import { createTaskSchema, updateTaskSchema } from "@/lib/schemas/tasks"
import { createNoticeSchema, updateNoticeSchema } from "@/lib/schemas/notices"

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
        "The stable, versioned external contract for building on VERIDIAN AI -- a mobile app, ChatGPT Action, Claude connector, reseller white-label app, or custom client integration all target this surface instead of the internal (app)/ UI's routes, which can change without notice. Currently covers compliance, tasks, and notices -- the highest-traffic domains; the remaining ~37 GRC modules are not yet exposed here.",
    },
    servers: [{ url: "https://veridian-compliance-ai.vercel.app/api/v1" }],
    components: {
      securitySchemes: { bearerAuth },
      schemas: {
        CreateComplianceItem: toSchema(createComplianceItemSchema),
        UpdateComplianceItem: toSchema(updateComplianceItemSchema),
        CreateTask: toSchema(createTaskSchema),
        UpdateTask: toSchema(updateTaskSchema),
        CreateNotice: toSchema(createNoticeSchema),
        UpdateNotice: toSchema(updateNoticeSchema),
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
    },
  }
}
