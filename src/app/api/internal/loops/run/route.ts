import { NextRequest, NextResponse } from "next/server";
import { db, loopDefinitions } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { runApiTokenAudit } from "@/lib/loops/api-token-audit";
import { runDataSeparationAudit } from "@/lib/loops/data-separation-audit";
import { runByoModelAudit } from "@/lib/loops/byo-model-audit";
import { runOutputDeliveryAudit } from "@/lib/loops/output-delivery-audit";
import { runAutomationProgressAudit } from "@/lib/loops/automation-progress-audit";
import { runUserBehaviourAudit } from "@/lib/loops/user-behaviour-audit";
import { runInputQualityAudit } from "@/lib/loops/input-quality-audit";
import { runLoopEngineeringAudit } from "@/lib/loops/loop-engineering-audit";
import { runKnowledgeFlowAudit } from "@/lib/loops/knowledge-flow-audit";
import { runProcessTurnaroundAudit } from "@/lib/loops/process-turnaround-audit";
import { runTierIntegrityAudit } from "@/lib/loops/tier-integrity-audit";
import { runCapabilityIndexFreshnessAudit } from "@/lib/loops/capability-index-freshness-audit";

/**
 * Cron-triggered entry point for Wave 5's active self-improvement loops.
 * Vercel Cron invokes this via GET with `Authorization: Bearer $CRON_SECRET`
 * (Vercel sets this automatically when CRON_SECRET is configured and this
 * path is listed in vercel.json's `crons`). Not session-authenticated --
 * there is no logged-in user for a scheduled job, so this uses a shared
 * secret instead of requireAuth().
 *
 * Only runs loops currently marked is_active in loop_definitions -- today
 * that's #1 (Loop Engineering), #4 (Knowledge Management), #5 (Process
 * Management), #7 (Input Management), #8 (Output Management), #9
 * (API/Token/URL Management), #10 (User Behaviour Management), #11 (Full
 * Automation Loop), #12 (Hierarchy & Secrecy Management), #13 (Data/Process
 * Separation), and #14 (BYO AI Model Loop), all read-only audits. See
 * orchestra_changes.md Wave 5 for why the remaining 4 are seeded but
 * inactive.
 *
 * Loop 1 runs last deliberately -- it observes the other loops'
 * loop_executions rows, so running it after them means it can see this
 * same run's activity, not just the prior run's.
 */
async function runActiveLoops() {
  const loopRows = await db.query.loopDefinitions.findMany({
    where: inArray(loopDefinitions.loopNumber, [1, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14]),
  });
  const byNumber = new Map(loopRows.map((l) => [l.loopNumber, l]));

  const results: Record<string, unknown> = {};

  const loop4 = byNumber.get(4);
  if (loop4?.isActive) {
    results.loop4_knowledgeFlowAudit = await runKnowledgeFlowAudit(loop4.id);
  }
  const loop5 = byNumber.get(5);
  if (loop5?.isActive) {
    results.loop5_processTurnaroundAudit = await runProcessTurnaroundAudit(loop5.id);
  }
  const loop7 = byNumber.get(7);
  if (loop7?.isActive) {
    results.loop7_inputQualityAudit = await runInputQualityAudit(loop7.id);
  }
  const loop8 = byNumber.get(8);
  if (loop8?.isActive) {
    results.loop8_outputDeliveryAudit = await runOutputDeliveryAudit(loop8.id);
  }
  const loop9 = byNumber.get(9);
  if (loop9?.isActive) {
    results.loop9_apiTokenAudit = await runApiTokenAudit(loop9.id);
  }
  const loop10 = byNumber.get(10);
  if (loop10?.isActive) {
    results.loop10_userBehaviourAudit = await runUserBehaviourAudit(loop10.id);
  }
  const loop11 = byNumber.get(11);
  if (loop11?.isActive) {
    results.loop11_automationProgressAudit = await runAutomationProgressAudit(loop11.id);
  }
  const loop12 = byNumber.get(12);
  if (loop12?.isActive) {
    results.loop12_dataSeparationAudit = await runDataSeparationAudit(loop12.id);
  }
  const loop13 = byNumber.get(13);
  if (loop13?.isActive) {
    results.loop13_tierIntegrityAudit = await runTierIntegrityAudit(loop13.id);
  }
  const loop14 = byNumber.get(14);
  if (loop14?.isActive) {
    results.loop14_byoModelAudit = await runByoModelAudit(loop14.id);
  }
  const loop1 = byNumber.get(1);
  if (loop1?.isActive) {
    results.loop1_loopEngineeringAudit = await runLoopEngineeringAudit(loop1.id);
  }

  // Not one of the 15 canonical loops (same reasoning as
  // instruction-mismatch-audit.ts) -- Capability Registry infrastructure
  // hygiene, piggybacked on this existing daily cron rather than adding a
  // 6th cron entry to vercel.json for something this cheap to run alongside
  // the others. Gap-closure fix, 2026-07-09.
  results.capabilityIndexFreshnessAudit = await runCapabilityIndexFreshnessAudit();

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
