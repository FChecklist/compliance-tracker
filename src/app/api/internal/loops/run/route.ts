import { NextRequest, NextResponse } from "next/server";
import { db, loopDefinitions } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { runApiTokenAudit } from "@/lib/loops/api-token-audit";
import { runDataSeparationAudit } from "@/lib/loops/data-separation-audit";
import { runByoModelAudit } from "@/lib/loops/byo-model-audit";
import { runOutputDeliveryAudit } from "@/lib/loops/output-delivery-audit";
import { runAutomationProgressAudit } from "@/lib/loops/automation-progress-audit";

/**
 * Cron-triggered entry point for Wave 5's active self-improvement loops.
 * Vercel Cron invokes this via GET with `Authorization: Bearer $CRON_SECRET`
 * (Vercel sets this automatically when CRON_SECRET is configured and this
 * path is listed in vercel.json's `crons`). Not session-authenticated --
 * there is no logged-in user for a scheduled job, so this uses a shared
 * secret instead of requireAuth().
 *
 * Only runs loops currently marked is_active in loop_definitions -- today
 * that's #8 (Output Management), #9 (API/Token/URL Management), #11 (Full
 * Automation Loop), #12 (Hierarchy & Secrecy Management), and #14 (BYO AI
 * Model Loop), all read-only audits. See orchestra_changes.md Wave 5 for
 * why the other 10 are seeded but inactive.
 */
async function runActiveLoops() {
  const loopRows = await db.query.loopDefinitions.findMany({
    where: inArray(loopDefinitions.loopNumber, [8, 9, 11, 12, 14]),
  });
  const byNumber = new Map(loopRows.map((l) => [l.loopNumber, l]));

  const results: Record<string, unknown> = {};

  const loop8 = byNumber.get(8);
  if (loop8?.isActive) {
    results.loop8_outputDeliveryAudit = await runOutputDeliveryAudit(loop8.id);
  }
  const loop9 = byNumber.get(9);
  if (loop9?.isActive) {
    results.loop9_apiTokenAudit = await runApiTokenAudit(loop9.id);
  }
  const loop11 = byNumber.get(11);
  if (loop11?.isActive) {
    results.loop11_automationProgressAudit = await runAutomationProgressAudit(loop11.id);
  }
  const loop12 = byNumber.get(12);
  if (loop12?.isActive) {
    results.loop12_dataSeparationAudit = await runDataSeparationAudit(loop12.id);
  }
  const loop14 = byNumber.get(14);
  if (loop14?.isActive) {
    results.loop14_byoModelAudit = await runByoModelAudit(loop14.id);
  }

  return results;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await runActiveLoops();
    return NextResponse.json({ ranAt: new Date().toISOString(), results });
  } catch (error) {
    console.error("Loop run failed:", error);
    return NextResponse.json({ error: "Loop run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
