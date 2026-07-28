// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-export /
// engine-prompt-import. Same "never a live DB from a .test.ts file"
// discipline as the other phase_8 service tests. Covers the real
// export -> import round trip end to end against a mocked DB.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const ADMIN_USER = { id: "user-1", role: "veridian_admin", orgId: "org-1" } as any
const CTX = { userId: ADMIN_USER.id, dbUser: ADMIN_USER }

afterEach(() => {
  mock.restore()
})

describe("exportPromptBundle", () => {
  test("404s for an unknown templateKey", async () => {
    // Spread the real module first -- compliance-service.ts (ServiceError's
    // home, imported by the module under test) named-imports auditLogs/
    // complianceItems/etc. from "@/lib/db" too, and a mock.module() factory
    // replaces the whole module namespace, so omitting those breaks that
    // unrelated import at evaluation time. `db` is a lazy Proxy (db/index.ts)
    // that opens no connection on import, so importing the real module here
    // is safe -- we override `db` below anyway.
    const actualDb = await import("@/lib/db")
    await mock.module("@/lib/db", () => ({
      ...actualDb,
      db: { query: { promptTemplates: { findFirst: mock(async () => undefined) } } },
      promptTemplates: {}, promptVersions: {},
    }))
    const { exportPromptBundle } = await import("./prompt-export-import-service")
    await expect(exportPromptBundle("missing.key")).rejects.toThrow(/Unknown templateKey/)
  })

  test("produces a real, versioned bundle for an existing template", async () => {
    const actualDb = await import("@/lib/db")
    await mock.module("@/lib/db", () => ({
      ...actualDb,
      db: {
        query: {
          promptTemplates: { findFirst: mock(async () => ({ id: "tmpl-1", templateKey: "chat.system", displayName: "Chat System", description: "desc" })) },
          promptVersions: { findMany: mock(async () => [
            { version: 1, content: "v1 content", label: null, major: 1, minor: 0, patch: 0 },
            { version: 2, content: "v2 content {{name}}", label: "production", major: 1, minor: 1, patch: 0 },
          ]) },
        },
      },
      promptTemplates: {}, promptVersions: {},
    }))
    const { exportPromptBundle, PROMPT_BUNDLE_FORMAT_VERSION } = await import("./prompt-export-import-service")

    const bundle = await exportPromptBundle("chat.system")

    expect(bundle.bundleFormatVersion).toBe(PROMPT_BUNDLE_FORMAT_VERSION)
    expect(bundle.templateKey).toBe("chat.system")
    expect(bundle.versions).toHaveLength(2)
    expect(bundle.versions[1]!.content).toBe("v2 content {{name}}")
  })
})

function buildTxMock(opts: { existingTemplate?: any; latestVersion?: any; insertedTemplate?: any; insertedVersion?: any }) {
  const promptTemplatesFindFirst = mock(async () => opts.existingTemplate)
  const promptVersionsFindFirst = mock(async () => opts.latestVersion)
  const templateInsertReturning = mock(async () => [opts.insertedTemplate])
  const versionInsertReturning = mock(async () => [opts.insertedVersion])
  let insertCallCount = 0
  const insert = mock((table: unknown) => {
    insertCallCount++
    const isFirstInsert = insertCallCount === 1
    return { values: mock(() => ({ returning: isFirstInsert && !opts.existingTemplate ? templateInsertReturning : versionInsertReturning })) }
  })
  return {
    tx: {
      query: {
        promptTemplates: { findFirst: promptTemplatesFindFirst },
        promptVersions: { findFirst: promptVersionsFindFirst },
      },
      insert,
    },
    promptTemplatesFindFirst, insert,
  }
}

async function setupImport(opts: Parameters<typeof buildTxMock>[0]) {
  const { tx, ...rest } = buildTxMock(opts)
  const transaction = mock(async (cb: (tx: unknown) => unknown) => cb(tx))
  const actualDb = await import("@/lib/db")
  await mock.module("@/lib/db", () => ({
    ...actualDb,
    db: { transaction },
    promptTemplates: {}, promptVersions: {},
  }))
  // Deliberately NOT mocking "./prompt-os-service" here: nextSemanticVersion
  // is a pure function (already covered by prompt-os-service.test.ts's own
  // suite), and bun's mock.module() replaces the module for the rest of the
  // test *process*, not just this file -- an earlier version of this test
  // stubbed it with a simplified (and semver-incorrect) fake that leaked
  // into prompt-os-service.test.ts's real "nextSemanticVersion" tests
  // whenever the full suite ran in one process, breaking 3 unrelated tests.
  return { transaction, ...rest }
}

describe("importPromptBundle", () => {
  const validBundle = {
    bundleFormatVersion: 1, templateKey: "chat.system", displayName: "Chat System", description: null,
    versions: [{ version: 1, content: "v1 content", label: null, major: 1, minor: 0, patch: 0 }],
    exportedAt: new Date().toISOString(),
  }

  test("rejects a malformed bundle", async () => {
    await setupImport({})
    const { importPromptBundle } = await import("./prompt-export-import-service")
    await expect(importPromptBundle(CTX, { not: "a bundle" })).rejects.toThrow(/Invalid prompt bundle/)
  })

  test("rejects an unsupported bundle format version", async () => {
    await setupImport({})
    const { importPromptBundle } = await import("./prompt-export-import-service")
    await expect(importPromptBundle(CTX, { ...validBundle, bundleFormatVersion: 99 })).rejects.toThrow(/Unsupported bundle format version/)
  })

  test("rejects a bundle with zero versions", async () => {
    await setupImport({})
    const { importPromptBundle } = await import("./prompt-export-import-service")
    await expect(importPromptBundle(CTX, { ...validBundle, versions: [] })).rejects.toThrow(/no versions/)
  })

  test("creates a new template and imports its version when the templateKey doesn't exist", async () => {
    await setupImport({
      existingTemplate: undefined,
      latestVersion: undefined,
      insertedTemplate: { id: "tmpl-new", templateKey: "chat.system" },
      insertedVersion: { id: "ver-new" },
    })
    const { importPromptBundle } = await import("./prompt-export-import-service")

    const result = await importPromptBundle(CTX, validBundle)

    expect(result.createdTemplate).toBe(true)
    expect(result.templateKey).toBe("chat.system")
    expect(result.importedVersionIds).toEqual(["ver-new"])
  })

  test("appends a new Draft version to an existing template without creating a duplicate", async () => {
    await setupImport({
      existingTemplate: { id: "tmpl-1", templateKey: "chat.system" },
      latestVersion: { version: 1, content: "different old content", major: 1, minor: 0, patch: 0 },
      insertedVersion: { id: "ver-2" },
    })
    const { importPromptBundle } = await import("./prompt-export-import-service")

    const result = await importPromptBundle(CTX, validBundle)

    expect(result.createdTemplate).toBe(false)
    expect(result.importedVersionIds).toEqual(["ver-2"])
  })

  test("skips re-importing a version whose content is unchanged (idempotent re-import)", async () => {
    await setupImport({
      existingTemplate: { id: "tmpl-1", templateKey: "chat.system" },
      latestVersion: { version: 1, content: "v1 content", major: 1, minor: 0, patch: 0 }, // identical to validBundle's version content
    })
    const { importPromptBundle } = await import("./prompt-export-import-service")

    const result = await importPromptBundle(CTX, validBundle)

    expect(result.importedVersionIds).toEqual([])
  })
})
