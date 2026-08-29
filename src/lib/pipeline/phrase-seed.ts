// R53 Phase 7 -- THE PHRASE MAP SEED. Level 0 is dead until this runs.
//
// compliance.phrase_map had 0 rows (measured 26 Aug 2026), so Level 0's
// phrase tier could never hit and EVERY segment paid for a Level 1 model
// call. l0_hit_rate was 0 by construction, not by measurement.
//
// SCOPE: platform.uat_function, 100 rows carrying requirement_id, page_path,
// nav_path and business_rule, covering 66 of Sumeet's 70 requirements. That
// catalogue is the boundary. REGISTER NO FUNCTION OUTSIDE THE 70 -- every
// function_id below is one of the eight the pipeline can actually execute,
// and each is cited to the uat_function row that puts it inside the 70.
//
// WHY THE PHRASES ARE NOT THE fn_name STRINGS: uat_function.fn_name is a
// TEST NAME, not something a person says. "Cumulative / Current / Balance
// amount columns" is a correct description of F034 and nobody has ever typed
// it. Seeding those verbatim would produce a phrase map with a 0% hit rate
// and the appearance of work. The phrases below are what a site engineer
// types to reach the screen that nav_path names -- English and the
// romanised Hindi the real corpus is full of.
//
// EXACT MATCH OR MISS (M26). Every phrase here is stored already normalised
// (lowercased, trailing .!? stripped, whitespace collapsed) by
// normaliseForMatch, which is the same function the lookup uses. A phrase
// that does not match exactly falls to Level 1 -- there is NO fuzzy tier and
// there must never be one.
import { normaliseForMatch } from "./classify";

export type SeedPhrase = {
  phrase: string;
  functionId: string;
};

/**
 * function_id -> the uat_function row that places it inside Sumeet's 70,
 * and the phrasings that reach it. Order within a function does not matter;
 * the unique index on (org_id, normalised_phrase) is what prevents two
 * functions claiming the same words, and a collision there is a REAL
 * ambiguity that must be resolved here rather than silently won by whichever
 * row inserted first.
 */
const CATALOGUE: ReadonlyArray<{ functionId: string; source: string; phrases: readonly string[] }> = [
  {
    functionId: "get_construction_budget_status",
    source: "F069 / R-C09 (Project > Budget) + F094 / R-C08",
    phrases: [
      "show me the budget",
      "show the budget",
      "show budget",
      "budget",
      "budget status",
      "project budget",
      "what is the budget",
      "how much budget is left",
      "budget kitna hai",
      "budget dikhao",
      "budget vs actual",
      "show me budget vs actual",
    ],
  },
  {
    functionId: "get_construction_project_dashboard",
    source: "F040 / R-50 (Project > Dashboard)",
    phrases: [
      "show me the dashboard",
      "show the dashboard",
      "show dashboard",
      "dashboard",
      "project dashboard",
      "how is this project doing",
      "how is this project doing overall",
      "how is the project doing",
      "project status",
      "show me the project status",
      "overall status",
      "project kaisa chal raha hai",
    ],
  },
  {
    functionId: "get_construction_kpi_status",
    source: "F071 / R-C11 (Project > Reports)",
    phrases: [
      "show me the kpis",
      "show the kpis",
      "kpi status",
      "kpis",
      "show me the report",
      "show the report",
      "project report",
    ],
  },
  {
    functionId: "list_delayed_activities",
    source: "F070 / R-C10 (Project > Schedule)",
    phrases: [
      "what is delayed",
      "show me delayed activities",
      "list delayed activities",
      "delayed activities",
      "what is behind schedule",
      "show delays",
      "kya late hai",
    ],
  },
  {
    functionId: "list_over_budget_projects",
    source: "F094 / R-C08 (Project > Budget)",
    phrases: [
      "which projects are over budget",
      "show me over budget projects",
      "list over budget projects",
      "over budget projects",
      "what is over budget",
    ],
  },
  {
    functionId: "generate_construction_progress_summary",
    source: "F088 / R-C11 (Project > Reports)",
    phrases: [
      "summarise progress",
      "summarize progress",
      "progress summary",
      "show me the progress summary",
      "give me a progress summary",
    ],
  },
  {
    functionId: "detect_construction_budget_schedule_risk",
    source: "F096 / R-C10 (Project > Reports)",
    phrases: [
      "what are the risks",
      "show me the risks",
      "risk report",
      "budget and schedule risk",
      "what could go wrong",
    ],
  },
  // record_work_progress is deliberately NOT seeded with bare phrases.
  // Progress is never a standalone phrase -- it always carries an item code
  // and a percentage ("PP1 is 50% done"), which classifyL0's STRUCTURAL tier
  // already resolves deterministically and for free. A phrase_map entry like
  // "record progress" would resolve to a WRITE function with no item code
  // and no percent, i.e. a task that can only ever ask for two missing
  // params. That is noise, not a hit.
];

/** Every seed row, already normalised, ready to insert. */
export function seedPhrases(): SeedPhrase[] {
  const out: SeedPhrase[] = [];
  const claimed = new Map<string, string>();
  for (const entry of CATALOGUE) {
    for (const raw of entry.phrases) {
      const phrase = normaliseForMatch(raw);
      const existing = claimed.get(phrase);
      if (existing && existing !== entry.functionId) {
        // A genuine ambiguity, surfaced loudly rather than silently resolved
        // by insert order. Two functions cannot own the same exact words.
        throw new Error(
          `phrase-seed: "${phrase}" is claimed by both ${existing} and ${entry.functionId}. Resolve it in CATALOGUE, not at insert time.`
        );
      }
      if (existing) continue;
      claimed.set(phrase, entry.functionId);
      out.push({ phrase, functionId: entry.functionId });
    }
  }
  return out;
}

export function seedSources(): { functionId: string; source: string; phraseCount: number }[] {
  return CATALOGUE.map((c) => ({ functionId: c.functionId, source: c.source, phraseCount: c.phrases.length }));
}

// R63 gap-closure (2026-08-29, owner directive: "complete the big domain/
// tool-scoping fix") -- a SEPARATE catalogue, deliberately not merged into
// CATALOGUE above: R53 Phase 7's own rule ("REGISTER NO FUNCTION OUTSIDE
// THE 70") is a real, still-true boundary for Sumeet's construction
// requirement set, and folding these in would misrepresent them as part of
// that 70. These are the compliance/ERP/CRM read-only functions added to
// executor.ts's EXECUTORS this same pass -- a different work order
// (platform-wide AI scope, not Sumeet's construction catalogue), so they
// get their own list rather than stretching the original's stated
// boundary. Live-inserted for Demo Organization (ve45lczmkodbiq1m20fy48r5)
// via direct SQL this same session (there is still no live caller of
// seedPhrases()/this export -- see this file's own header, unchanged
// since R53: Level 0's phrase tier is fed by whatever is actually in
// compliance.phrase_map, not by this file running anywhere in production
// yet). Kept here so the two don't drift, per this file's own
// "exactly one list, not two" convention -- just two SEPARATE ones for two
// separate, non-overlapping scopes.
const ERP_CRM_COMPLIANCE_CATALOGUE: ReadonlyArray<{ functionId: string; source: string; phrases: readonly string[] }> = [
  { functionId: "get_overdue_items", source: "compliance domain (DOMAIN_ALLOWED_TOOLS.compliance)", phrases: ["show me overdue items", "overdue items", "what is overdue"] },
  { functionId: "get_compliance_stats", source: "compliance domain", phrases: ["compliance stats", "show me compliance stats"] },
  { functionId: "list_departments", source: "compliance domain", phrases: ["list my departments", "show departments"] },
  { functionId: "list_compliance_items", source: "compliance domain", phrases: ["list compliance items"] },
  { functionId: "list_notices", source: "compliance domain", phrases: ["show my notices", "list notices"] },
  { functionId: "list_gst_returns", source: "compliance domain", phrases: ["gst filing status", "what is my gst filing status"] },
  { functionId: "list_gst_import_batches", source: "compliance domain", phrases: ["gst import batches"] },
  { functionId: "list_customers", source: "erp domain (2026-08-29 addition)", phrases: ["list my customers", "show me my customers", "customers"] },
  { functionId: "list_sales_orders", source: "erp domain", phrases: ["list my sales orders", "show me sales orders"] },
  { functionId: "list_leads", source: "crm domain (2026-08-29 addition)", phrases: ["list my leads", "show me my leads", "leads"] },
  { functionId: "list_opportunities", source: "crm domain", phrases: ["list my opportunities", "show me my opportunities", "opportunities"] },
  { functionId: "get_sales_pipeline_overview", source: "crm domain", phrases: ["sales pipeline", "show me the sales pipeline", "pipeline overview"] },
];

export function seedErpCrmCompliancePhrases(): SeedPhrase[] {
  const out: SeedPhrase[] = [];
  const claimed = new Map<string, string>();
  for (const entry of ERP_CRM_COMPLIANCE_CATALOGUE) {
    for (const raw of entry.phrases) {
      const phrase = normaliseForMatch(raw);
      const existing = claimed.get(phrase);
      if (existing && existing !== entry.functionId) {
        throw new Error(`phrase-seed: "${phrase}" is claimed by both ${existing} and ${entry.functionId}. Resolve it in ERP_CRM_COMPLIANCE_CATALOGUE, not at insert time.`);
      }
      if (existing) continue;
      claimed.set(phrase, entry.functionId);
      out.push({ phrase, functionId: entry.functionId });
    }
  }
  return out;
}
