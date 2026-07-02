import { NextRequest, NextResponse } from "next/server";
import { db, loopDefinitions } from "@/lib/db";
import { eq } from "drizzle-orm";
import { runApiTokenAudit } from "@/lib/loops/api-token-audit";
import { runDataSeparationAudit } from "@/lib/loops/data-separation-audit";
import { runByoModelAudit } from "@/lib/loops/byo-model-audit";

/**
 * Cron-triggered entry point for Wave 5's active self-improvement loops.
 * Vercel Cron invokes this via GET with `Authorization: Bearer $CRON_SECRET`
 * (Vercel sets this automatically when CRON_SECRET is configured and this
 * path is listed in vercel.json's `crons`). Not session-authenticated --
 * there is no logged-in user for a scheduled job, so this uses a shared
 * secret instead of requireAuth().
 *
 * Only runs loops currently marked is_active in loop_definitions -- today
 * that's #9 (API/Token/URL Management), #12 (Hierarchy & Secrecy
 * Management), and #14 (BYO AI Model Loop), all read-only audits. See
 * orchestra_changes.md Wave 5 for why the other 12 are seeded but inactive.
 */
async function runActiveLoops() {
  const [loop9, loop12, loop14] = await Promise.all([
    db.query.loopDefinitions.findFirst({ where: eq(loopDefinitions.loopNumber, 9) }),
    db.query.loopDefinitions.findFirst({ where: eq(loopDefinitions.loopNumber, 12) }),
    db.query.loopDefinitions.findFirst({ where: eq(loopDefinitions.loopNumber, 14) }),
  ]);

  const results: Record<string, unknown> = {};

  if (loop9?.isActive) {
    results.loop9_apiTokenAudit = await runApiTokenAudit(loop9.id);
  }
  if (loop12?.isActive) {
    results.loop12_dataSeparationAudit = await runDataSeparationAudit(loop12.id);
  }
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
