/// <reference types="bun-types" />
import { describe, expect, test, beforeEach } from "bun:test"
import { subscribe, publish, _clearAllListenersForTests } from "./event-bus"

beforeEach(() => {
  _clearAllListenersForTests()
})

describe("event-bus", () => {
  test("publish delivers the payload to a subscribed handler", async () => {
    let received: unknown = null
    subscribe("task.created", (payload) => {
      received = payload
    })
    await publish("task.created", { orgId: "org1", taskId: "task1" })
    expect(received).toEqual({ orgId: "org1", taskId: "task1" })
  })

  test("publish with no subscribers resolves without throwing", async () => {
    await expect(publish("task.created", { orgId: "org1", taskId: "task1" })).resolves.toBeUndefined()
  })

  test("multiple subscribers to the same event all receive it", async () => {
    let count = 0
    subscribe("task.created", () => { count++ })
    subscribe("task.created", () => { count++ })
    await publish("task.created", { orgId: "org1", taskId: "task1" })
    expect(count).toBe(2)
  })

  test("unsubscribe stops further delivery", async () => {
    let count = 0
    const unsubscribe = subscribe("task.created", () => { count++ })
    unsubscribe()
    await publish("task.created", { orgId: "org1", taskId: "task1" })
    expect(count).toBe(0)
  })

  test("a throwing subscriber does not prevent other subscribers from running", async () => {
    let secondRan = false
    subscribe("task.created", () => {
      throw new Error("boom")
    })
    subscribe("task.created", () => {
      secondRan = true
    })
    await publish("task.created", { orgId: "org1", taskId: "task1" })
    expect(secondRan).toBe(true)
  })

  test("a throwing subscriber does not reject the publish() promise", async () => {
    subscribe("task.created", () => {
      throw new Error("boom")
    })
    await expect(publish("task.created", { orgId: "org1", taskId: "task1" })).resolves.toBeUndefined()
  })

  test("events are isolated from each other", async () => {
    let taskCreatedCount = 0
    let loopProposedCount = 0
    subscribe("task.created", () => { taskCreatedCount++ })
    subscribe("loop.improvement_proposed", () => { loopProposedCount++ })
    await publish("task.created", { orgId: "org1", taskId: "task1" })
    expect(taskCreatedCount).toBe(1)
    expect(loopProposedCount).toBe(0)
  })
})
