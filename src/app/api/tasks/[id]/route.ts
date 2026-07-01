import { tasks, taskExecutionPlan, taskChatMessages } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
      if (!task) return null;

      const [plan, chat] = await Promise.all([
        db.query.taskExecutionPlan.findMany({
          where: eq(taskExecutionPlan.taskId, id),
          orderBy: asc(taskExecutionPlan.stepNumber),
        }),
        db.query.taskChatMessages.findMany({
          where: eq(taskChatMessages.taskId, id),
          orderBy: asc(taskChatMessages.createdAt),
        }),
      ]);

      return { task, plan, chat };
    });

    if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const { task, plan, chat } = result;

    return NextResponse.json({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      assistantId: task.assistantId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      executionPlan: plan.map((p) => ({
        id: p.id,
        stepNumber: p.stepNumber,
        workerAgentId: p.workerAgentId,
        description: p.description,
        status: p.status,
      })),
      chat: chat.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Task detail error:", error);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status)) {
          return { error: `status must be one of: ${VALID_STATUSES.join(", ")}`, status: 400 as const };
        }
        updates.status = body.status;
      }
      if (body.title !== undefined) {
        const trimmed = typeof body.title === "string" ? body.title.trim() : "";
        if (!trimmed) return { error: "title cannot be empty", status: 400 as const };
        updates.title = trimmed;
      }
      if (body.description !== undefined) {
        updates.description = typeof body.description === "string" ? body.description.trim() : null;
      }

      const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
      return { updated };
    });

    if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { updated } = result;

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Task update error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
