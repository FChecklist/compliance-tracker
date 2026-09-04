// R74 Y4-06: the ONE result-recording path every test in Phases 5-9 uses.
// Never write a result by hand outside this function (that phase's own
// instruction) -- this is what makes every result carry the same fields
// and the same commit SHA discipline.
//
// CORRECTED from Y4-06's literal text: it names "platform.uat_result" as
// the write target, but that table turns out (confirmed by testing, not
// assumed) to belong to a DIFFERENT, older, FK-constrained system --
// platform.uat_test/uat_result/uat_scorecard is a frozen, 13-metric,
// 20-point-per-test ledger (fn_id/persona_id/page_path/criteria_total,
// canary/must_fail flags) from an earlier work order, explicitly protected
// by this work order's own GY-08 ("MAY NOT add a uat_scorecard metric,
// frozen at 13"). Shoehorning Sumeet-requirement results into its FK-gated
// test_id namespace would mean inventing fn_id/persona_id/page_path values
// that don't correspond to anything real, and risks disturbing whatever
// reads its frozen scorecard. The table actually built for this job already
// exists: platform.sumeet_uat itself carries a full per-test evidence trail
// (actual_observed, deviation, evidence, screenshot_ref, run_at,
// attempt_count, notes) for exactly these 218 rows. This helper updates
// those columns on the matching test_no row instead.
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  db: { schema: "platform" },
});

function currentSha(): string {
  return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
}

export interface R74ResultInput {
  testNo: string; // sumeet_uat.test_no, e.g. "R-04-L3-01"
  requirementRef?: string; // sumeet_uat.requirement_ref, only set if changed
  result: "PASS" | "FAIL" | "BLOCKED"; // written to status
  observed: string; // -> actual_observed
  expectedOverride?: string; // only pass if expected_exact needs updating
  deviation?: string; // filled when result != PASS
  artefactPath?: string; // -> screenshot_ref (Playwright screenshot/trace path)
  agentId: string; // "R74-PM" or a real r74_agent_register.agent_id -- appended to notes
}

/** The single write path for every R74 Phase 5-9 test result (Y4-06, corrected target). */
export async function recordR74Result(input: R74ResultInput) {
  const sha = currentSha();
  const runAt = new Date().toISOString();
  const noteLine = `R74 result @ ${runAt}, commit ${sha}, by ${input.agentId}: ${input.result}`;

  const { data: existing, error: fetchErr } = await supabase
    .from("sumeet_uat")
    .select("attempt_count, notes")
    .eq("test_no", input.testNo)
    .single();
  if (fetchErr) throw new Error(`R74 result write failed (lookup) for ${input.testNo}: ${fetchErr.message}`);

  const { error } = await supabase
    .from("sumeet_uat")
    .update({
      status: input.result,
      actual_observed: input.observed,
      deviation: input.deviation ?? null,
      screenshot_ref: input.artefactPath ?? null,
      run_at: runAt,
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      notes: existing?.notes ? `${existing.notes}\n\n${noteLine}` : noteLine,
      ...(input.requirementRef ? { requirement_ref: input.requirementRef } : {}),
      ...(input.expectedOverride ? { expected_exact: input.expectedOverride } : {}),
    })
    .eq("test_no", input.testNo);
  if (error) throw new Error(`R74 result write failed for ${input.testNo}: ${error.message}`);
}
