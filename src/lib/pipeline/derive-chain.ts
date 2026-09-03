// R53 Phase 5 -- PHRASE -> FUNCTION -> CHAIN. NEVER THE REVERSE.
//
// M26 rules it plainly: "The phrase map must key PHRASE -> function_id, and
// DERIVE the chain from the function. NOT chain -> function. The phrase is
// the authority; the chain is OUTPUT, not input."
//
// That is why this file takes a function_id and returns a chain, and has no
// function that goes the other way. A caller cannot accidentally let a
// user's pill selection decide which function runs -- there is no code path
// here that would let it. submissions.selected_chain stays what M25 calls
// it: a HINT, never binding.
//
// THE DEFECT THIS CLOSES: derived_chain is NULL on all 16 live
// compliance.pipeline_tasks rows and selected_chain is NULL on all 16
// compliance.submissions rows. Nothing has ever written either.
//
// PURE at its core (buildChain), with the DB reads behind a repo interface
// so the derivation table is testable without a database.

export type ScreenFacts = {
  functionId: string;
  breadcrumbTemplate: string | null;
  flowParent: string | null;
};

export type ChainRepo = {
  /**
   * compliance.screen_definitions. READ ONLY to R53 -- R52 owns every write
   * to that table. Returns null for a function with no screen row, which is
   * the common case today: of its 16 rows exactly ONE carries a
   * breadcrumb_template and NONE carries a flow_parent (measured 26 Aug
   * 2026). That is why tier 2 below exists and is not dead code.
   */
  findScreen(functionId: string): Promise<ScreenFacts | null>;
};

export type DerivedChain = {
  /** M24: "MODE IS THE ENTITY THE CHAIN ROOTS ON" -- Projects, Customers, Vendors. */
  mode: string;
  /** The rooted entity's own name. "Oakwood Residence - Full Renovation", or "All projects". */
  root: string;
  steps: string[];
  /** The whole chain, rendered. M24: never a fragment -- "Import BOQ" alone is ambiguous. */
  full: string;
};

// ---------------------------------------------------------------------------
// TIER 2 SOURCE: platform.uat_function.nav_path.
//
// nav_path is ALREADY M24's grammar -- "Project > Scope > New BOQ",
// "Project > Work Progress > New entry" -- for all 100 catalogue rows
// covering 66 of Sumeet's 70 requirements. This map is the join between the
// eight function_ids the pipeline can actually run and the catalogue rows
// that describe where they live. Every entry cites the uat_function row it
// came from, so it is checkable rather than asserted.
//
// IT REGISTERS NO FUNCTION OUTSIDE THE 70 (R53 Phase 7's rule): every
// nav_path below is copied verbatim from a real platform.uat_function row.
// A function with no catalogue row does not get invented one here -- it
// falls to tier 3.
//
// It lives in code, not in a new table, because R53 forbids creating one and
// uat_function has no column that could hold a pipeline function_id.
const NAV_PATH_BY_FUNCTION: Readonly<Record<string, string>> = {
  // F030 / R-40 "Record partial progress against a weighted sub-task"
  record_work_progress: "Project > Work Progress > New entry",
  // F040 / R-50 "Project value matches BOQ total"
  get_construction_project_dashboard: "Project > Dashboard",
  // F069 / R-C09 "Budget percent defaults to 25 and is changeable per scope item"
  get_construction_budget_status: "Project > Budget",
  // R67 B-02: the same catalogue row (F069), reached by PROJEXA's Budget card
  // id. Sharing the row rather than inventing a nav_path keeps R53 Phase 7's
  // rule -- no function outside the 70 gets a chain invented for it.
  review_budget: "Project > Budget",
  // F094 / R-C08 "Material cost flows into the budget figure"
  list_over_budget_projects: "Project > Budget",
  // F071 / R-C11 "Revenue / Budget / Actual report scope-wise"
  get_construction_kpi_status: "Project > Reports",
  // F088 / R-C11 "Report figures reconcile to the database exactly"
  generate_construction_progress_summary: "Project > Reports",
  // F096 / R-C10 "Schedule baseline variance is shown"
  detect_construction_budget_schedule_risk: "Project > Reports",
  // F070 / R-C10 "Project schedule task and baseline"
  list_delayed_activities: "Project > Schedule",
};

// nav_path and breadcrumb_template both open with a generic placeholder for
// the rooted entity. The root is supplied by the caller from real data (the
// project's own name), so the placeholder is dropped rather than rendered --
// otherwise every chain would read "Oakwood > Project > Work Progress".
const GENERIC_ROOT_TOKENS = new Set(["project", "projects", "customer", "customers", "vendor", "vendors", "home", "open projexa-ai.com"]);

// Tier 3 only. Verb prefixes carried by the real function_ids in this
// codebase, mapped to the word a user would recognise. Not a general
// English rule -- a closed list, extended only when a real function_id needs it.
const VERB_PREFIXES: ReadonlyArray<[string, string]> = [
  ["record_", "Record"],
  ["create_", "Create"],
  ["update_", "Update"],
  ["delete_", "Delete"],
  ["import_", "Import"],
  ["approve_", "Approve"],
  ["generate_", "Generate"],
  ["detect_", "Check"],
  ["list_", "View"],
  ["get_", "View"],
];

function titleCase(token: string): string {
  return token.length === 0 ? token : token[0].toUpperCase() + token.slice(1);
}

function splitChainString(raw: string): string[] {
  // Both separators occur in real data: nav_path uses ">", the single live
  // breadcrumb_template ("Permits · {project} · {permitNumber}") uses "·".
  return raw
    .split(/[>·]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function dropGenericRoot(steps: string[]): string[] {
  if (steps.length > 1 && GENERIC_ROOT_TOKENS.has(steps[0].toLowerCase())) return steps.slice(1);
  return steps;
}

/**
 * Fill a breadcrumb_template's {placeholders} from what the caller actually
 * knows. A placeholder with no value is DROPPED, never rendered as literal
 * "{permitNumber}" and never guessed -- an unfilled slot means that segment
 * of the chain is not knowable yet, not that it should show braces to a
 * site engineer.
 */
function fillTemplate(template: string, values: Record<string, unknown>): string[] {
  return splitChainString(template)
    .map((part) =>
      part.replace(/\{(\w+)\}/g, (_match, key: string) => {
        const v = values[key];
        return v === undefined || v === null || v === "" ? "" : String(v);
      }).trim()
    )
    .filter((part) => part.length > 0 && !/^\{.*\}$/.test(part));
}

export type BuildChainInput = {
  /** M24's mode pill -- the entity the chain roots on. */
  mode: string;
  /** The rooted entity's real name. Null means no entity is selected. */
  rootLabel: string | null;
  functionId: string;
  params: Record<string, unknown>;
  /** compliance.screen_definitions row, or null. */
  screen: ScreenFacts | null;
  /** Ancestor screens from walking flow_parent, nearest first. Empty when there are none. */
  ancestors?: ScreenFacts[];
};

/**
 * PURE. Three tiers, first one that yields steps wins:
 *
 *   1. compliance.screen_definitions -- breadcrumb_template, plus any
 *      ancestors reached by walking flow_parent. The work order's stated
 *      source, and the one that will carry everything once R52 populates it.
 *   2. platform.uat_function.nav_path via NAV_PATH_BY_FUNCTION above.
 *   3. The function_id itself, decomposed deterministically.
 *
 * TIER 3 NEVER RETURNS NOTHING. A chain is always derivable, because a NULL
 * derived_chain is exactly the defect this phase exists to remove -- and
 * "we could not name it" is not a reason to write NULL when the function_id
 * itself is a perfectly good name for what the user just did.
 */
export function buildChain(input: BuildChainInput): DerivedChain {
  const { mode, rootLabel, functionId, params, screen, ancestors = [] } = input;
  const root = rootLabel && rootLabel.trim().length > 0 ? rootLabel.trim() : `All ${mode.toLowerCase()}`;

  let steps: string[] = [];

  // ---- Tier 1: screen_definitions --------------------------------------
  if (screen?.breadcrumbTemplate) {
    steps = dropGenericRoot(fillTemplate(screen.breadcrumbTemplate, { ...params, project: rootLabel ?? "", mode }));
  }
  if (steps.length === 0 && ancestors.length > 0) {
    // flow_parent walk, furthest ancestor first, then this screen.
    const walked = [...ancestors].reverse().map((a) => humaniseFunctionId(a.functionId).join(" "));
    steps = dropGenericRoot([...walked, ...humaniseFunctionId(functionId)]);
  }

  // ---- Tier 2: uat_function nav_path -----------------------------------
  if (steps.length === 0) {
    const nav = NAV_PATH_BY_FUNCTION[functionId];
    if (nav) steps = dropGenericRoot(splitChainString(nav));
  }

  // ---- Tier 3: the function_id itself ----------------------------------
  if (steps.length === 0) steps = humaniseFunctionId(functionId);

  return { mode, root, steps, full: [root, ...steps].join(" > ") };
}

/**
 * "record_work_progress" -> ["Work Progress", "Record"]
 * "get_construction_budget_status" -> ["Construction Budget Status", "View"]
 *
 * ENTITY > ACTION > STEP, M24's grammar: the noun phrase comes first and the
 * verb last, so the chain still reads as one sentence after the root is
 * prepended. Deterministic and reversible by eye -- a reader can always tell
 * which function_id produced a tier-3 chain, which matters when the chain is
 * the only thing in the history drop-down.
 */
function humaniseFunctionId(functionId: string): string[] {
  const prefix = VERB_PREFIXES.find(([p]) => functionId.startsWith(p));
  const remainder = prefix ? functionId.slice(prefix[0].length) : functionId;
  const noun = remainder.split("_").filter(Boolean).map(titleCase).join(" ");
  if (!noun) return [titleCase(functionId)];
  return prefix ? [noun, prefix[1]] : [noun];
}

/**
 * The DB-backed derivation. Walks flow_parent up to a bounded depth --
 * screen_definitions is user-editable data and a cycle in it must degrade to
 * a shorter chain, never hang a request.
 */
export async function deriveChain(
  repo: ChainRepo,
  input: { mode: string; rootLabel: string | null; functionId: string; params: Record<string, unknown> }
): Promise<DerivedChain> {
  const screen = await repo.findScreen(input.functionId);
  const ancestors: ScreenFacts[] = [];
  const seen = new Set<string>([input.functionId]);
  let parentId = screen?.flowParent ?? null;
  for (let depth = 0; depth < 5 && parentId; depth++) {
    if (seen.has(parentId)) break; // cycle in screen_definitions -- stop, do not hang
    seen.add(parentId);
    const parent = await repo.findScreen(parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.flowParent;
  }
  return buildChain({ ...input, screen, ancestors });
}

export { NAV_PATH_BY_FUNCTION };
