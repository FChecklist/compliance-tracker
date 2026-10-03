import { describe, expect, test } from "bun:test"
import { memoryKv } from "./kv"
import { createCopyStore } from "./copy-store"
import { isNetworkError } from "./network"
import { fromStored, loadWithCopy, toStored } from "./page-copy"
import { percentOf, isIosSafari } from "./device"

type P = { org: { id: string }; rows: Array<{ id: string; due: Date; yes: boolean }> }
const page = (): P => ({ org: { id: "o" }, rows: [{ id: "a", due: new Date("2026-10-10T00:00:00Z"), yes: false }] })
const net = (e: unknown) => isNetworkError(e, true)
const off = () => Promise.reject(new TypeError("Failed to fetch"))

describe("loadWithCopy", () => {
  test("round-trips dates", () => {
    const back = fromStored<P>(toStored(page()))
    expect(back.rows[0].due).toBeInstanceOf(Date)
    expect(back.rows[0].due.toISOString()).toBe("2026-10-10T00:00:00.000Z")
  })
  test("online: serves the server and keeps a copy; later offline: serves that copy", async () => {
    const store = createCopyStore(memoryKv())
    const a = await loadWithCopy<P, string>({ fetchPage: async () => page(), fetchClients: async () => ["c"], store, email: "a@x.in", org: null, isNetwork: net })
    expect(a.source).toBe("server")
    await new Promise((r) => setTimeout(r, 10)) // the save is not awaited by design
    const b = await loadWithCopy<P, string>({ fetchPage: off, fetchClients: off, store, email: "a@x.in", org: null, isNetwork: net })
    expect(b.source).toBe("device")
    expect(b.savedAt).toBeTruthy()
    expect(b.clients).toEqual(["c"])
    expect(b.page.rows[0].due).toBeInstanceOf(Date)
  })
  test("offline with no copy yet: the network error stands", async () => {
    const store = createCopyStore(memoryKv())
    await expect(loadWithCopy<P, string>({ fetchPage: off, fetchClients: off, store, email: "a@x.in", org: null, isNetwork: net })).rejects.toThrow("Failed to fetch")
  })
  test("a server refusal is never papered over with old data", async () => {
    const store = createCopyStore(memoryKv())
    await store.saveSnapshot("a@x.in", null, toStored(page()), [])
    const refusal = Object.assign(new Error("no active membership"), { code: "P0001" })
    await expect(loadWithCopy<P, string>({ fetchPage: () => Promise.reject(refusal), fetchClients: async () => [], store, email: "a@x.in", org: null, isNetwork: net })).rejects.toBe(refusal)
  })
  test("another person's copy is never served", async () => {
    const store = createCopyStore(memoryKv())
    await store.saveSnapshot("a@x.in", null, toStored(page()), [])
    await expect(loadWithCopy<P, string>({ fetchPage: off, fetchClients: off, store, email: "b@x.in", org: null, isNetwork: net })).rejects.toThrow()
  })
})

describe("device helpers", () => {
  test("percentOf", () => { expect(percentOf(0, 0)).toBe(0); expect(percentOf(3, 4)).toBe(75); expect(percentOf(9, 4)).toBe(100) })
  test("isIosSafari", () => {
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604")).toBe(true)
    expect(isIosSafari("Mozilla/5.0 (iPhone) CriOS/120 Mobile Safari")).toBe(false)
    expect(isIosSafari("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false)
  })
})
