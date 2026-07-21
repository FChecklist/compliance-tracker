import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { opsDevTasks } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

/**
 * Bridge endpoint (2026-07-20): VERIDIAN-DEV (Hetzner ops server) POSTs
 * autonomous coding-task checkpoint state here so it's queryable from this
 * app's own database, closing the "two machines, zero bridge" gap between
 * app-layer and ops-layer task tracking. Same shared-secret pattern as
 * CRON_SECRET-gated /api/internal/* routes -- there is no user session for
 * a server-to-server call from the ops box.
 *
 * Upserts by opsTaskId (the Hetzner task_id, e.g.
 * task-20260720-060747-billstack-...). Best-effort by design on the
 * caller's side (veridian-task.py wraps this call with a short timeout and
 * never blocks a checkpoint on it succeeding) -- this endpoint itself
 * still validates its input strictly and returns real errors, it just
 * isn't load-bearing for the ops-layer's own state.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.OPS_SYNC_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

interface OpsTaskSyncPayload {
  ops_task_id: string
  title: string
  repo: string
  branch?: string
  status: string
  pr_url?: string
  software_task_id?: string
  ai_task_id?: string
  execution_seconds?: number
  restart_count?: number
  last_checkpoint_note?: string
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payload: OpsTaskSyncPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!payload.ops_task_id || !payload.title || !payload.repo || !payload.status) {
    return NextResponse.json(
      { error: "ops_task_id, title, repo, and status are required" },
      { status: 400 }
    )
  }

  try {
    const existing = await db
      .select({ id: opsDevTasks.id })
      .from(opsDevTasks)
      .where(eq(opsDevTasks.opsTaskId, payload.ops_task_id))
      .limit(1)

    const row = {
      title: payload.title,
      repo: payload.repo,
      branch: payload.branch ?? null,
      status: payload.status,
      prUrl: payload.pr_url ?? null,
      softwareTaskId: payload.software_task_id ?? null,
      aiTaskId: payload.ai_task_id ?? null,
      executionSeconds: payload.execution_seconds ?? null,
      restartCount: payload.restart_count ?? null,
      lastCheckpointNote: payload.last_checkpoint_note ?? null,
      lastSyncedAt: new Date(),
    }

    if (existing.length > 0) {
      await db.update(opsDevTasks).set(row).where(eq(opsDevTasks.opsTaskId, payload.ops_task_id))
    } else {
      await db.insert(opsDevTasks).values({ opsTaskId: payload.ops_task_id, ...row })
    }

    return NextResponse.json({ synced: true, ops_task_id: payload.ops_task_id })
  } catch (error) {
    console.error("ops-task-sync failed:", error)
    return NextResponse.json({ error: "Sync failed" }, { status: 500 })
  }
}
