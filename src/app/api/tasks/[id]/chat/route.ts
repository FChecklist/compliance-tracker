import { tasks, taskChatMessages } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
      if (!task) return null;

      const [message] = await db
        .insert(taskChatMessages)
        .values({ taskId: id, role: "user", content })
        .returning();
      return message;
    });

    if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    return NextResponse.json(
      {
        id: result.id,
        role: result.role,
        content: result.content,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Task chat message error:", error);
    return NextResponse.json({ error: "Failed to post message" }, { status: 500 });
  }
}
