/// <reference types="bun-types" />
// UAT 2026-10-12: an action item added to a MoM from PROJEXA was handed to the AI task executor, which marked the assignee's to-do "failed"
// within seconds whenever no model was available. A person's action item is done by that person, so this route must record it and NOT dispatch it
// (autoExecute: false) -- the same rule the AI work link already follows (PROJEXA-BUILD-002 WP-05e).
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import type { users } from "@/lib/db"

setDefaultTimeout(20000)

type DbUser = typeof users.$inferSelect

async function mockRoute() {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { role: "member" } as unknown as DbUser, apiKey: null, response: null })),
    requireActingPerson: mock(async () => ({ acting: { person: { id: "user-1" }, actor: {} }, error: null })),
  }))
  const addMeetingActionItem = mock(async () => ({ id: "ai-1", taskId: "t-1" }))
  const service = await import("@/lib/services/veri-meeting-service")
  mock.module("@/lib/services/veri-meeting-service", () => ({ ...service, addMeetingActionItem }))
  return addMeetingActionItem
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/projexa/veri-meetings/m1/action-items", {
    method: "POST",
    headers: { authorization: "Bearer vk_test", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/projexa/veri-meetings/[id]/action-items", () => {
  test("records the action item for the named person and does NOT hand it to the AI executor", async () => {
    const addMeetingActionItem = await mockRoute()
    const { POST } = await import("./route")

    const res = await POST(post({ title: "Confirm 120 bags cement delivery", assigneeUserId: "u-manoj", dueDate: "2026-10-15" }) as any, {
      params: Promise.resolve({ id: "m1" }),
    })

    expect(res.status).toBe(201)
    expect(addMeetingActionItem).toHaveBeenCalledTimes(1)
    const call = addMeetingActionItem.mock.calls[0] as unknown as unknown[]
    expect(call[1]).toBe("m1")
    expect(call[2]).toEqual({ title: "Confirm 120 bags cement delivery", assigneeUserId: "u-manoj", dueDate: "2026-10-15" })
    expect(call[3]).toEqual({ autoExecute: false })
  })
})
