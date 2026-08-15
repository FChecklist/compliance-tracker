// Tenant isolation for this task's 4 project-records modules (Permits,
// Drawings & 3D, Documents all reuse createDocumentRecord/listDocuments;
// MoMs reuses createVeriMeeting/listVeriMeetings). Same pattern as the
// existing tenant-isolation.test.ts: exercise the real service functions,
// mock only withTenantContext, and prove every call only ever reaches it
// with the orgId that was actually passed in.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

const ORG_A = "org-projexa-records-a"
const ORG_B = "org-projexa-records-b"

let capturedOrgIds: string[] = []

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  capturedOrgIds.push(_ctx.orgId)
  return fn({
    insert: () => ({ values: () => ({ returning: async () => [{ id: "doc-1", orgId: _ctx.orgId }] }) }),
    query: { documents: { findMany: async () => [] }, veriMeetings: { findMany: async () => [] } },
  } as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realLogActivity = await import("@/lib/audit")

async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/audit", () => realLogActivity)
}

beforeEach(() => {
  capturedOrgIds = []
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("Tenant isolation: Permits/Drawings/Documents (documents table)", () => {
  test("listDocuments with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { listDocuments } = await import("@/lib/services/document-service")
    await listDocuments({ orgId: ORG_A }, { category: "permit" })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every((id) => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some((id) => id === ORG_B)).toBe(false)
  })

  test("listDocuments with ORG_B context only reaches withTenantContext with ORG_B", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { listDocuments } = await import("@/lib/services/document-service")
    await listDocuments({ orgId: ORG_B }, { category: "drawing" })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every((id) => id === ORG_B)).toBe(true)
    expect(capturedOrgIds.some((id) => id === ORG_A)).toBe(false)
  })

  test("createDocumentRecord (link-only, no storage upload) with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createDocumentRecord } = await import("@/lib/services/document-service")
    await createDocumentRecord(
      { orgId: ORG_A, userId: "user-a" },
      { name: "3D Walkthrough", category: "drawing_3d", externalUrl: "https://example.com/tour", linkedEntityType: "project", linkedEntityId: "proj-1" }
    )

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every((id) => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some((id) => id === ORG_B)).toBe(false)
  })
})

describe("Tenant isolation: Minutes of Meeting (veriMeetings)", () => {
  test("listVeriMeetings with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { listVeriMeetings } = await import("@/lib/services/veri-meeting-service")
    await listVeriMeetings({ orgId: ORG_A }, "proj-1")

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every((id) => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some((id) => id === ORG_B)).toBe(false)
  })

  test("createVeriMeeting (API-key actor) with ORG_B context only reaches withTenantContext with ORG_B", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    await mock.module("@/lib/audit", () => ({ logActivity: mock(async () => {}) }))
    const { createVeriMeeting } = await import("@/lib/services/veri-meeting-service")
    await createVeriMeeting(
      { orgId: ORG_B, userId: "user-b", apiKey: { id: "key-1", name: "PROJEXA" } },
      { title: "Site Kickoff", scheduledAt: "2026-07-28T10:00:00.000Z", contextEntityType: "project", contextEntityId: "proj-9" }
    )

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every((id) => id === ORG_B)).toBe(true)
    expect(capturedOrgIds.some((id) => id === ORG_A)).toBe(false)
  })
})
