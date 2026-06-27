import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { notifications } from "@compliancetrack/db";
import { and, eq, desc, count } from "drizzle-orm";
import { z } from "zod";

// ─── GET /api/notifications ────────────────────────────────────────
// User's notification inbox with unread count.
// Query params: ?page=1&per_page=25&unread=true
export const GET = withAuth(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const per_page = Math.min(100, Math.max(1, Number(sp.get("per_page")) || 25));
  const offset = (page - 1) * per_page;
  const onlyUnread = sp.get("unread") === "true";

  // Unread count (always return)
  const [{ unread_count }] = await db
    .select({ unread_count: count() })
    .from(notifications)
    .where(and(eq(notifications.user_id, ctx.userId), eq(notifications.is_read, false)));

  // Fetch notifications
  const whereClause = and(
    eq(notifications.user_id, ctx.userId),
    onlyUnread ? eq(notifications.is_read, false) : undefined
  );

  const rows = await db.select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.created_at))
    .limit(per_page)
    .offset(offset);

  return NextResponse.json({ success: true, data: rows, meta: { unread_count } });
});

// ─── PATCH /api/notifications ──────────────────────────────────────
// Mark a single notification as read, or mark all as read.
// Body: { notification_id?: string, mark_all?: boolean }
const patchSchema = z.object({
  notification_id: z.string().uuid().optional(),
  mark_all: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { notification_id, mark_all } = parsed.data;

  if (mark_all) {
    await db.update(notifications).set({ is_read: true })
      .where(and(eq(notifications.user_id, ctx.userId), eq(notifications.is_read, false)));
    return NextResponse.json({ success: true, data: { marked_read: "all" } });
  }

  if (notification_id) {
    await db.update(notifications).set({ is_read: true })
      .where(and(eq(notifications.id, notification_id), eq(notifications.user_id, ctx.userId)));
    return NextResponse.json({ success: true, data: { marked_read: notification_id } });
  }

  return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Provide either notification_id or mark_all" } }, { status: 400 });
});