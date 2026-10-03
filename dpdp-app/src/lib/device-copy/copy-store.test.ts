import { describe, expect, test } from "bun:test"
import { memoryKv } from "./kv"
import { createCopyStore, type StoredPage } from "./copy-store"
import { isNetworkError } from "./network"

const page = (): StoredPage => ({ org: { id: "o1" }, rows: [{ id: "a", due: "2026-10-10T00:00:00.000Z", yes: false }, { id: "b", due: "2026-10-11T00:00:00.000Z", yes: false }] })
let n = 0
const mk = () => createCopyStore(memoryKv(), () => new Date("2026-10-03T10:00:00Z"), () => `t${++n}`)

describe("copy on the device", () => {
  test("saves and reloads the last good page, per person", async () => {
    const s = mk()
    await s.saveSnapshot("A@x.in", null, page(), [])
    expect((await s.loadSnapshot("a@x.in", null))?.savedAt).toBe("2026-10-03T10:00:00.000Z")
    expect(await s.loadSnapshot("b@x.in", null)).toBeNull() // a second person on the same laptop sees nothing of the first
  })
  test("an offline tap shows done at once and waits to be sent, once", async () => {
    const s = mk()
    await s.saveSnapshot("a@x.in", null, page(), [])
    await s.queueMarkDone("a@x.in", null, "a")
    await s.queueMarkDone("a@x.in", null, "a")
    expect((await s.pending("a@x.in")).length).toBe(1)
    expect((await s.loadSnapshot("a@x.in", null))!.page.rows.map((r) => r.yes)).toEqual([true, false])
  })
  test("flush sends in order, removes accepted taps, drops refused ones, keeps the rest on a network failure", async () => {
    const s = mk()
    for (const id of ["a", "b", "c"]) await s.queueMarkDone("a@x.in", null, id)
    const seen: string[] = []
    const r = await s.flush("a@x.in", async (id) => { seen.push(id); if (id === "b") throw Object.assign(new Error("closed"), { code: "P0001" }); if (id === "c") throw new TypeError("Failed to fetch") }, (e) => isNetworkError(e, true))
    expect(seen).toEqual(["a", "b", "c"])
    expect(r).toEqual({ sent: 1, refused: 1, left: 1 })
    expect((await s.pending("a@x.in")).map((t) => t.obligationId)).toEqual(["c"])
  })
  test("keepOnly removes everything that is not the signed-in person's", async () => {
    const s = mk()
    await s.saveSnapshot("a@x.in", null, page(), [])
    await s.saveSnapshot("b@x.in", null, page(), [])
    await s.queueMarkDone("a@x.in", null, "a")
    await s.keepOnly("B@x.in")
    expect(await s.loadSnapshot("a@x.in", null)).toBeNull()
    expect(await s.pending("a@x.in")).toEqual([])
    expect(await s.loadSnapshot("b@x.in", null)).not.toBeNull()
  })
  test("wipe removes the page and the waiting taps", async () => {
    const s = mk()
    await s.saveSnapshot("a@x.in", null, page(), [])
    await s.queueMarkDone("a@x.in", null, "a")
    await s.wipe()
    expect(await s.loadSnapshot("a@x.in", null)).toBeNull()
    expect(await s.pending("a@x.in")).toEqual([])
  })
})

describe("isNetworkError", () => {
  test("offline, TypeError and bare fetch messages are network; coded refusals are not", () => {
    expect(isNetworkError(new Error("x"), false)).toBe(true)
    expect(isNetworkError(new TypeError("Failed to fetch"), true)).toBe(true)
    expect(isNetworkError(new Error("TypeError: Failed to fetch"), true)).toBe(true)
    expect(isNetworkError(Object.assign(new Error("no active membership"), { code: "P0001" }), true)).toBe(false)
    expect(isNetworkError(Object.assign(new Error("Failed to fetch"), { code: "PGRST301" }), true)).toBe(false)
  })
})
