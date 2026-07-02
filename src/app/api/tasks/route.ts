import { tasks, aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { executeTask } from "@/lib/task-execution-engine";

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ tasks: [] });

  try {
    const assistantId = request.nextUrl.searchParams.get("assistantId");

    const result = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.tasks.findMany({
        where: assistantId ? eq(tasks.assistantId, assistantId) : undefined,
        orderBy: desc(tasks.createdAt),
      })
    );

    return NextResponse.json({
      tasks: result.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assistantId: t.assistantId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Tasks list error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const assistantId = typeof body.assistantId === "string" ? body.assistantId : null;

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      if (assistantId) {
        // RLS already prevents assigning to another user's assistant; this
        // check just gives a clean 400 instead of a foreign-key failure.
        const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, assistantId) });
        if (!assistant) return null;
      }
      const [created] = await db
        .insert(tasks)
        .values({ orgId, userId: dbUser.id, assistantId, title, description, status: "in_progress" })
        .returning();
      return created;
    });

    if (!result) return NextResponse.json({ error: "Assistant not found" }, { status: 404 });

    // Real task execution engine (Wave 4): synchronously plans this task
    // against the org's actual worker agent roster and records the outcome
    // -- same synchronous-LLM-call-in-request pattern already used by
    // ai/orchestrate. Updates the task's own status/chat as a side effect;
    // re-fetch to return the true final state rather than the initial insert.
    await executeTask(orgId, dbUser.id, result.id, result.title, result.description);
    const final = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.tasks.findFirst({ where: eq(tasks.id, result.id) })
    );

    return NextResponse.json(
      {
        id: result.id,
        title: result.title,
        description: result.description,
        status: final?.status ?? result.status,
        assistantId: result.assistantId,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Task create error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
