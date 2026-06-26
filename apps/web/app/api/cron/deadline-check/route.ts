import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliance/db";
import { compliance, complianceHistory, notifications } from "@compliance/db/schema";
import { and, eq, lte, gte, inArray, not, isNull } from "drizzle-orm";

// ─── GET /api/cron/deadline-check ──────────────────────────────────
// Vercel Cron — runs daily at 08:00 UTC.
// 1. Find items due within 7 days (status != completed).
// 2. Insert deadline_approaching notifications for assignees.
// 3. Mark overdue items (due_date < now()) as status = 'overdue'.
//
// Secured by CRON_SECRET bearer token.
export async function GET(request: NextRequest) {
  // ── Cron auth ────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  let approachingCount = 0;
  let overdueMarked = 0;

  // ── Step 1: Items due within 7 days, not completed/overdue, with assignee
  const approaching = await db
    .select({
      id: compliance.id,
      title: compliance.title,
      due_date: compliance.due_date,
      assignee_id: compliance.assignee_id,
      org_id: compliance.org_id,
      unique_url_slug: compliance.unique_url_slug,
    })
    .from(compliance)
    .where(
      and(
        not(eq(compliance.status, "completed")),
        not(eq(compliance.status, "overdue")),
        not(isNull(compliance.assignee_id)),
        not(isNull(compliance.due_date)),
        gte(compliance.due_date, now),
        lte(compliance.due_date, sevenDaysFromNow),
      )
    );

  approachingCount = approaching.length;

  // Insert deadline_approaching notifications
  if (approaching.length > 0) {
    const notifRows = approaching.map((item) => {
      const daysLeft = Math.ceil(
        (new Date(item.due_date!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        org_id: item.org_id,
        user_id: item.assignee_id!,
        type: "deadline_approaching" as const,
        title: `Deadline approaching: ${item.title}`,
        body: `Your compliance item "${item.title}" is due in ${daysLeft} day(s) (${new Date(item.due_date!).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}).`,
        link_url: `/compliance/${item.unique_url_slug}`,
      };
    });
    await db.insert(notifications).values(notifRows);
  }

  // ── Step 2: Mark overdue items (due_date < now, not completed/overdue)
  const overdueItems = await db
    .select({
      id: compliance.id,
      title: compliance.title,
      due_date: compliance.due_date,
      assignee_id: compliance.assignee_id,
      org_id: compliance.org_id,
      unique_url_slug: compliance.unique_url_slug,
      status: compliance.status,
    })
    .from(compliance)
    .where(
      and(
        not(eq(compliance.status, "completed")),
        not(eq(compliance.status, "overdue")),
        not(isNull(compliance.due_date)),
        lte(compliance.due_date, now),
        not(isNull(compliance.assignee_id)),
      )
    );

  overdueMarked = overdueItems.length;

  if (overdueItems.length > 0) {
    const overdueIds = overdueItems.map((i) => i.id);

    // Update status to 'overdue'
    await db
      .update(compliance)
      .set({ status: "overdue", updated_at: now })
      .where(inArray(compliance.id, overdueIds));

    // Insert compliance_history for each
    const historyRows = overdueItems.map((item) => ({
      compliance_id: item.id,
      old_status: item.status,
      new_status: "overdue" as const,
      changed_by: item.assignee_id!,
      change_reason: "Automatically marked overdue by deadline cron",
    }));
    await db.insert(complianceHistory).values(historyRows);

    // Insert overdue notifications
    const overdueNotifs = overdueItems.map((item) => ({
      org_id: item.org_id,
      user_id: item.assignee_id!,
      type: "overdue" as const,
      title: `Overdue: ${item.title}`,
      body: `"${item.title}" was due on ${new Date(item.due_date!).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} and has been marked as overdue.`,
      link_url: `/compliance/${item.unique_url_slug}`,
    }));
    await db.insert(notifications).values(overdueNotifs);
  }

  return NextResponse.json({
    success: true,
    data: {
      checked_at: now.toISOString(),
      approaching_count: approachingCount,
      overdue_marked: overdueMarked,
    },
  });
}

// POST for manual trigger (Vercel dashboard test)
export async function POST(request: NextRequest) {
  return GET(request);
}