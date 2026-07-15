// Priority 21, Layer 2 Workspace Memory -- see
// ai-os/priority21_workspace_memory_design.md for the full design and the
// real feasibility check this implementation is based on.
//
// Produces/consumes a portable, per-(org,user) memvid (.mv2) capsule
// containing ONLY the acting user's own saved report definitions and their
// own recent AI-thread conversation dialogue -- never another user's data,
// never a live re-query of the underlying compliance/financial records
// (see the design doc's DATA-03 discussion for exactly why that line is
// deliberate). Uses @memvid/sdk's core, non-AI API only
// (create/open/put/timeline/getFrameInfo/view/seal, kind: "basic") -- no
// `.ask()`, no adapters, no embeddings, no LLM calls, matching the design
// doc's §2 feasibility finding that this is the only part of the SDK v1
// needs to touch.
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"
import { eq, and, inArray, desc, asc } from "drizzle-orm"
import {
  conversations,
  conversationParticipants,
  messages,
  savedReports,
  workspaceMemoryCapsuleEvents,
  type users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"

// Telemetry closes the design doc's §2.5 finding: @memvid/sdk phones home a
// path-hash + command-name event on every operation by default. Set before
// the module is ever required, not per-call (the SDK reads it at call
// time) -- this is the one place in the codebase that imports @memvid/sdk,
// so this is also the one place responsible for disabling it.
process.env.MEMVID_TELEMETRY = "0"

const BUCKET = "compliance-documents"
const SIGNED_URL_TTL_SECONDS = 300
const MAX_IMPORT_SIZE_BYTES = 25 * 1024 * 1024 // matches documents route's own bucket-limit ceiling
const MAX_CONVERSATIONS = 20
const MAX_MESSAGES_PER_CONVERSATION = 200

export class ServiceError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

type CapsuleItemMetadata = {
  type: "saved_report" | "conversation"
  sourceId: string
  orgId: string
  exportedAt: string
}

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function tmpCapsulePath(): string {
  return path.join(os.tmpdir(), `workspace-memory-${createId()}.mv2`)
}

// ─── Export ──────────────────────────────────────────────────────────────

export type ExportResult = {
  eventId: string
  signedUrl: string
  expiresInSeconds: number
  fileSizeBytes: number
  itemCounts: { savedReports: number; conversations: number; messages: number }
}

export async function exportWorkspaceMemory(
  ctx: { orgId: string; dbUser: typeof users.$inferSelect },
  request?: Request
): Promise<ExportResult> {
  const { orgId, dbUser } = ctx
  const userId = dbUser.id

  // Lazy import -- @memvid/sdk pulls a genuinely heavy install-time
  // dependency tree (see design doc §2.3); importing it only inside the two
  // functions that actually need it keeps every other route/service in this
  // codebase completely unaffected, and (per §2.3) next.config.ts's
  // serverExternalPackages entry is what keeps it out of unrelated bundles.
  const { create, MemvidError } = await import("@memvid/sdk")

  const own = await withTenantContext({ orgId, userId }, async (db) => {
    const reports = await db.query.savedReports.findMany({
      where: eq(savedReports.ownedById, userId),
      orderBy: desc(savedReports.updatedAt),
    })

    const myParticipation = await db.query.conversationParticipants.findMany({
      where: eq(conversationParticipants.userId, userId),
    })
    const convoIds = myParticipation.map((p) => p.conversationId)
    const convos = convoIds.length
      ? await db.query.conversations.findMany({
          where: and(inArray(conversations.id, convoIds), eq(conversations.isAiThread, true)),
          orderBy: desc(conversations.updatedAt),
          limit: MAX_CONVERSATIONS,
        })
      : []

    const conversationsWithMessages = await Promise.all(
      convos.map(async (convo) => {
        const msgs = await db.query.messages.findMany({
          where: eq(messages.conversationId, convo.id),
          orderBy: asc(messages.createdAt),
          limit: MAX_MESSAGES_PER_CONVERSATION,
        })
        return { convo, msgs }
      })
    )

    return { reports, conversationsWithMessages }
  })

  const tmpPath = tmpCapsulePath()
  const exportedAt = new Date().toISOString()
  let messageCount = 0

  try {
    const mv = await create(tmpPath, "basic")
    try {
      for (const report of own.reports) {
        const metadata: CapsuleItemMetadata = { type: "saved_report", sourceId: report.id, orgId, exportedAt }
        await mv.put({
          title: report.name,
          text: JSON.stringify({
            name: report.name,
            description: report.description,
            sourceEntity: report.sourceEntity,
            filters: report.filters,
            groupByField: report.groupByField,
            chartType: report.chartType,
          }),
          metadata,
        })
      }
      for (const { convo, msgs } of own.conversationsWithMessages) {
        const metadata: CapsuleItemMetadata = { type: "conversation", sourceId: convo.id, orgId, exportedAt }
        messageCount += msgs.length
        await mv.put({
          title: convo.title ?? "Untitled conversation",
          text: JSON.stringify({
            title: convo.title,
            createdAt: convo.createdAt.toISOString(),
            messages: msgs.map((m) => ({
              senderId: m.senderId,
              assistantId: m.assistantId,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            })),
          }),
          metadata,
        })
      }
      await mv.seal()
    } finally {
      // no explicit close() in the Memvid interface -- seal() flushes to disk
    }

    const bytes = await fs.readFile(tmpPath)
    const objectPath = `${orgId}/workspace-memory/${userId}/${createId()}.mv2`
    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: "application/octet-stream",
      upsert: false,
    })
    if (uploadError) {
      throw new ServiceError("Failed to store workspace memory capsule", 500)
    }

    const itemCounts = {
      savedReports: own.reports.length,
      conversations: own.conversationsWithMessages.length,
      messages: messageCount,
    }

    const event = await withTenantContext({ orgId, userId }, async (db) => {
      const [row] = await db
        .insert(workspaceMemoryCapsuleEvents)
        .values({
          orgId,
          userId,
          direction: "export",
          storageObjectPath: objectPath,
          fileSizeBytes: bytes.byteLength,
          itemCounts,
          status: "completed",
        })
        .returning()

      await logActivity({
        tx: db,
        action: "export",
        entityType: "WorkspaceMemoryCapsule",
        entityId: row.id,
        details: `Exported workspace memory capsule (${itemCounts.savedReports} saved reports, ${itemCounts.conversations} conversations)`,
        orgId,
        dbUser,
        request,
      })

      return row
    })

    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS)
    if (error || !data) {
      throw new ServiceError("Capsule stored but failed to generate a download link", 500)
    }

    return {
      eventId: event.id,
      signedUrl: data.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      fileSizeBytes: bytes.byteLength,
      itemCounts,
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    if (err instanceof MemvidError) throw new ServiceError(`Failed to build workspace memory capsule: ${err.message}`, 500)
    throw err
  } finally {
    await fs.unlink(tmpPath).catch(() => {})
  }
}

// ─── Import ──────────────────────────────────────────────────────────────

export type ImportResult = {
  eventId: string
  itemCounts: { savedReports: number; conversations: number }
}

// Conversations are deliberately NOT reinjected into the live
// conversations/messages tables -- see design doc §3.4/§5 for why: that
// model has real participant/FK/RLS semantics a capsule doesn't carry, and
// silently resurrecting old AI-thread history is exactly the kind of
// silent-corruption risk SEC-04 exists to prevent. v1 parses them here only
// to report an accurate count back to the caller -- the original uploaded
// capsule itself (containing the full conversation content) is preserved
// as-is at `objectPath` in the bucket, so nothing is lost, but this pass
// does not build a dedicated in-app viewer for that content (that would be
// a real, separate UI addition, not implied by anything already built).
export type ImportedConversationPreview = {
  title: string | null
  createdAt: string
  messages: { senderId: string | null; assistantId: string | null; content: string; createdAt: string }[]
}

export async function importWorkspaceMemory(
  ctx: { orgId: string; dbUser: typeof users.$inferSelect },
  fileBytes: Buffer,
  request?: Request
): Promise<ImportResult> {
  const { orgId, dbUser } = ctx
  const userId = dbUser.id

  if (fileBytes.byteLength > MAX_IMPORT_SIZE_BYTES) {
    throw new ServiceError("Capsule exceeds 25 MB limit", 400)
  }

  const { open, doctorMemvid, MemvidError } = await import("@memvid/sdk")
  const tmpPath = tmpCapsulePath()

  try {
    await fs.writeFile(tmpPath, fileBytes)

    // Fail closed on a corrupt/foreign file before any database write.
    try {
      await doctorMemvid(tmpPath)
    } catch {
      throw new ServiceError("This file is not a valid workspace memory capsule", 400)
    }

    const mv = await open(tmpPath, "basic")
    const entries = await mv.timeline({ limit: 10000 })

    const savedReportItems: { title: string; body: Record<string, unknown> }[] = []
    const conversationItems: ImportedConversationPreview[] = []

    for (const entry of entries) {
      const info = await mv.getFrameInfo(entry.frame_id)
      const metadata = info.metadata as Partial<CapsuleItemMetadata> | undefined
      if (!metadata?.type) continue
      const content = await mv.view(entry.frame_id)
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (metadata.type === "saved_report") {
        savedReportItems.push({ title: (parsed.name as string) ?? "Imported report", body: parsed })
      } else if (metadata.type === "conversation") {
        conversationItems.push(parsed as unknown as ImportedConversationPreview)
      }
    }

    const objectPath = `${orgId}/workspace-memory/${userId}/imports/${createId()}.mv2`
    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, fileBytes, {
      contentType: "application/octet-stream",
      upsert: false,
    })
    if (uploadError) throw new ServiceError("Failed to store the imported capsule", 500)

    const importedAt = new Date().toISOString()

    const event = await withTenantContext({ orgId, userId }, async (db) => {
      // Additive-only per SEC-04: a saved_report entry always becomes a NEW
      // row, never an UPDATE of an existing one. Name collision is resolved
      // by suffixing, never by silent overwrite.
      for (const item of savedReportItems) {
        const existing = await db.query.savedReports.findFirst({
          where: and(eq(savedReports.ownedById, userId), eq(savedReports.name, item.title)),
        })
        const name = existing ? `${item.title} (imported ${importedAt.slice(0, 10)})` : item.title
        await db.insert(savedReports).values({
          orgId,
          ownedById: userId,
          name,
          description: (item.body.description as string) ?? null,
          sourceEntity: (item.body.sourceEntity as string) ?? "ai_generated",
          filters: (item.body.filters as Record<string, unknown>) ?? {},
          groupByField: (item.body.groupByField as string) ?? null,
          chartType: (item.body.chartType as string) ?? "table",
          visibility: "private",
        })
      }

      const itemCounts = { savedReports: savedReportItems.length, conversations: conversationItems.length }

      const [row] = await db
        .insert(workspaceMemoryCapsuleEvents)
        .values({
          orgId,
          userId,
          direction: "import",
          storageObjectPath: objectPath,
          fileSizeBytes: fileBytes.byteLength,
          itemCounts,
          status: "completed",
        })
        .returning()

      await logActivity({
        tx: db,
        action: "import",
        entityType: "WorkspaceMemoryCapsule",
        entityId: row.id,
        details: `Imported workspace memory capsule (${itemCounts.savedReports} saved reports added, ${itemCounts.conversations} conversations viewable read-only)`,
        orgId,
        dbUser,
        request,
      })

      return row
    })

    return { eventId: event.id, itemCounts: { savedReports: savedReportItems.length, conversations: conversationItems.length } }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    if (err instanceof MemvidError) throw new ServiceError(`Failed to read workspace memory capsule: ${err.message}`, 400)
    throw err
  } finally {
    await fs.unlink(tmpPath).catch(() => {})
  }
}

// ─── Listing (Settings UI) ───────────────────────────────────────────────

export async function listWorkspaceMemoryEvents(ctx: { orgId: string; userId: string }, db: TenantDb) {
  return db.query.workspaceMemoryCapsuleEvents.findMany({
    where: and(eq(workspaceMemoryCapsuleEvents.orgId, ctx.orgId), eq(workspaceMemoryCapsuleEvents.userId, ctx.userId)),
    orderBy: desc(workspaceMemoryCapsuleEvents.createdAt),
    limit: 20,
  })
}
