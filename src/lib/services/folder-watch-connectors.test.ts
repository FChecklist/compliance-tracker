/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-13 (register row AW-605): the two real sources of the folder scan (a Gmail mailbox and a Drive folder, folder-
// watch-connectors.ts) with the connector's read function replaced by a fake, so nothing reaches Composio. The response shapes are the
// documented ones, read defensively (see that file's header: UNVERIFIED against a live account); what is proven here is what the code
// does with them and what it sends.
//
// WHAT IS PROVEN
//   1. a Drive listing asks for the folder's non-folder children modified after the cursor, oldest first, and reads names, times, sizes;
//      an id or label that is not plain letters, digits, hyphen and underscore is refused before any query is built (no injection);
//   2. a mailbox listing asks for messages with an xlsx attachment, one second before the cursor (so a same-second message is not
//      missed), and turns each attachment into a file with the message's time and the sender's bare lower-case address;
//   3. a download is accepted only as base64, wherever the response nests it, bounded BEFORE decoding; a response that carries only an
//      address to fetch is refused (the server fetches no address it is handed), and a connector refusal is a stable code;
//   4. the read function is only ever asked for read actions: the four actions named here are the whole list.
//
// Run: bun test --isolate src/lib/services/folder-watch-connectors.test.ts
import { describe, expect, test } from "bun:test"
import {
  bytesFromDownload,
  createDriveFolderSource,
  createMailboxSource,
  decodeBase64Bounded,
  filesFromMessages,
  senderAddress,
  type ConnectorRead,
  type ConnectorReadResult,
} from "./folder-watch-connectors"
import { FolderSourceError, type FolderFile } from "./folder-watch-service"
import { classifyConnectorActionCategory } from "@/lib/composio-connectors"

function fakeRead(answers: Record<string, ConnectorReadResult>) {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = []
  const read: ConnectorRead = async (action, args) => {
    calls.push({ action, args })
    return answers[action] ?? { successful: false, data: null, error: "no such action" }
  }
  return { read, calls }
}
const ok = (data: unknown): ConnectorReadResult => ({ successful: true, data, error: null })
const b64 = (text: string) => Buffer.from(text).toString("base64")
const file = (id: string): FolderFile => ({ id, name: "a.xlsx", mimeType: null, sizeBytes: 1, modifiedAt: new Date() })

describe("a Drive folder", () => {
  test("lists the folder's files after the cursor, oldest first, with name, time and size", async () => {
    const f = fakeRead({ GOOGLEDRIVE_FIND_FILE: ok({ files: [{ id: "f1", name: "Bill.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-09-27T10:05:00.000Z", size: "2048" }, { name: "no id" }, { id: "f2" }] }) })
    const source = createDriveFolderSource(f.read, { folderId: "1AbCdEfGhIj_kLm-No" })
    const listed = await source.list({ after: new Date("2026-09-27T10:00:00.000Z"), limit: 20 })
    expect(listed).toEqual([{ id: "f1", name: "Bill.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 2048, modifiedAt: new Date("2026-09-27T10:05:00.000Z") }])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].action).toBe("GOOGLEDRIVE_FIND_FILE")
    expect(f.calls[0].args).toMatchObject({ orderBy: "modifiedTime asc", pageSize: 20 })
    expect(f.calls[0].args.q).toBe("'1AbCdEfGhIj_kLm-No' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and modifiedTime > '2026-09-27T10:00:00.000Z'")
  })

  test("with no cursor the query has no time; a page size is bounded", async () => {
    const f = fakeRead({ GOOGLEDRIVE_FIND_FILE: ok([]) })
    const source = createDriveFolderSource(f.read, { folderId: "1AbCdEfGhIj" })
    await source.list({ after: null, limit: 9999 })
    expect(String(f.calls[0].args.q)).not.toContain("modifiedTime >")
    expect(f.calls[0].args.pageSize).toBe(100)
  })

  test("a folder id that could change the query is refused before any call", () => {
    const f = fakeRead({})
    for (const bad of ["x' or name contains 'y", "abc def ghi", "a/b/c/d/e/f", "short", "1AbCdEfGh' in parents or '1", ""]) {
      expect(() => createDriveFolderSource(f.read, { folderId: bad })).toThrow(FolderSourceError)
    }
    expect(f.calls).toHaveLength(0)
  })

  test("a connector refusal is a stable code, without the connector's text", async () => {
    const f = fakeRead({ GOOGLEDRIVE_FIND_FILE: { successful: false, data: null, error: "secret detail from upstream" } })
    const source = createDriveFolderSource(f.read, { folderId: "1AbCdEfGhIj" })
    const err = await source.list({ after: null, limit: 5 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FolderSourceError)
    expect((err as FolderSourceError).code).toBe("source_read_failed")
    expect((err as FolderSourceError).message).not.toContain("secret detail")
  })

  test("a download is the base64 the connector returns, wherever it nests it", async () => {
    const f = fakeRead({ GOOGLEDRIVE_DOWNLOAD_FILE: ok({ file: { name: "a.xlsx", content: b64("PK-bytes") } }) })
    const bytes = await createDriveFolderSource(f.read, { folderId: "1AbCdEfGhIj" }).download(file("f1"), 1000)
    expect(new TextDecoder().decode(bytes)).toBe("PK-bytes")
    expect(f.calls[0]).toEqual({ action: "GOOGLEDRIVE_DOWNLOAD_FILE", args: { file_id: "f1" } })
  })
})

describe("a mailbox", () => {
  const message = (over: Record<string, unknown> = {}) => ({
    messageId: "m1",
    internalDate: String(Date.UTC(2026, 8, 27, 10, 5)),
    sender: "Asha Manager <Asha.M@Example.test>",
    attachmentList: [{ filename: "Bill.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", attachmentId: "att1", size: 4096 }, { filename: "notes.txt", attachmentId: "att2" }],
    ...over,
  })

  test("asks for xlsx attachments one second before the cursor, and lists each attachment with the message's time and the sender", async () => {
    const f = fakeRead({ GMAIL_FETCH_EMAILS: ok({ messages: [message()] }) })
    const source = createMailboxSource(f.read, { label: "projects" })
    const listed = await source.list({ after: new Date(Date.UTC(2026, 8, 27, 10, 0, 30)), limit: 500 })
    expect(f.calls[0].args).toMatchObject({ user_id: "me", max_results: 50, include_payload: true })
    expect(f.calls[0].args.query).toBe(`has:attachment filename:xlsx label:projects after:${Math.floor(Date.UTC(2026, 8, 27, 10, 0, 30) / 1000) - 1}`)
    expect(listed).toEqual([
      { id: "m1:att1", name: "Bill.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 4096, modifiedAt: new Date(Date.UTC(2026, 8, 27, 10, 5)), sender: "asha.m@example.test" },
      { id: "m1:att2", name: "notes.txt", mimeType: null, sizeBytes: null, modifiedAt: new Date(Date.UTC(2026, 8, 27, 10, 5)), sender: "asha.m@example.test" },
    ])
  })

  test("a label that could change the query is refused; a message with no time or id is left out; the sender may come from the payload headers", () => {
    const f = fakeRead({})
    for (const bad of ["a b", "x OR in:anywhere", "label:x", ""]) expect(() => createMailboxSource(f.read, { label: bad })).toThrow(FolderSourceError)
    const files = filesFromMessages({
      messages: [
        message({ messageId: "", sender: undefined }),
        message({ internalDate: undefined }),
        message({ messageId: "m9", sender: undefined, payload: { headers: [{ name: "Subject", value: "x" }, { name: "From", value: "Bob <bob@vendor.test>" }] }, attachmentList: [{ filename: "b.xlsx", attachmentId: "a9" }] }),
      ],
    })
    expect(files.map((x) => [x.id, x.sender])).toEqual([["m9:a9", "bob@vendor.test"]])
  })

  test("downloads the attachment by message and attachment id", async () => {
    const f = fakeRead({ GMAIL_GET_ATTACHMENT: ok({ data: { content: b64("PK-mail") } }) })
    const bytes = await createMailboxSource(f.read).download({ ...file("m1:att1"), name: "Bill.xlsx" }, 1000)
    expect(new TextDecoder().decode(bytes)).toBe("PK-mail")
    expect(f.calls[0]).toEqual({ action: "GMAIL_GET_ATTACHMENT", args: { user_id: "me", message_id: "m1", attachment_id: "att1", file_name: "Bill.xlsx" } })
    await expect(createMailboxSource(f.read).download(file("no-colon"), 1000)).rejects.toMatchObject({ code: "bad_file" })
  })
})

describe("what a download may be", () => {
  test("base64 is bounded before it is decoded", () => {
    expect(decodeBase64Bounded(b64("hello"), 100)).toEqual(new Uint8Array(Buffer.from("hello")))
    expect(decodeBase64Bounded(b64("x".repeat(1000)), 100)).toBeNull()
    expect(decodeBase64Bounded("not base64 !!", 100)).toBeNull()
    expect(decodeBase64Bounded("", 100)).toBeNull()
    // base64url is accepted
    expect(decodeBase64Bounded(Buffer.from([251, 255, 254]).toString("base64url"), 100)).toEqual(new Uint8Array([251, 255, 254]))
  })

  test("an answer that carries only an address is refused, and one that is too large says so", () => {
    expect(() => bytesFromDownload({ file: { s3url: "https://files.example.test/a.xlsx" } }, 100)).toThrow(expect.objectContaining({ code: "download_shape_unsupported" }))
    expect(() => bytesFromDownload(null, 100)).toThrow(expect.objectContaining({ code: "download_shape_unsupported" }))
    expect(() => bytesFromDownload({ content: b64("y".repeat(5000)) }, 100)).toThrow(expect.objectContaining({ code: "file_too_large" }))
  })

  test("sender addresses are reduced to the bare lower-case address", () => {
    expect(senderAddress("Asha <ASHA@Example.test>")).toBe("asha@example.test")
    expect(senderAddress("  bob@vendor.test ")).toBe("bob@vendor.test")
    expect(senderAddress("no address here")).toBeNull()
    expect(senderAddress(42)).toBeNull()
  })

  test("every action this file names is a read for the CRR-158 gate", () => {
    for (const action of ["GMAIL_FETCH_EMAILS", "GMAIL_GET_ATTACHMENT", "GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_DOWNLOAD_FILE"]) {
      expect(classifyConnectorActionCategory(action)).toBe("read")
    }
  })
})
