// PROJEXA-BUILD-002 WP-04 -- the fixtures the BOQ payload tests share (executor-boq-payload, -batches, -seal and -redaction).
//
// Only data and small builders live here: every test file installs its own mock of @/lib/db/tenant-scoped (a module mock is per file),
// with fakeWithTenantContext from boq-store-double.ts. Lives in __test-helpers__ for the reason pipeline-store-double.ts does: a test seam
// is not a module that owes the repo a sibling test.
import { makeBoqStore, seedRows, type BoqStore, type Row } from "./boq-store-double";

export const ORG = "org_1";
export const OTHER_ORG = "org_2";
export const PROJECT_A = "project_a";
export const PROJECT_B = "project_b";
export const PROJECT_OTHER_ORG = "project_x";
/** A manager and a member of ORG: rank 3 sees money and may seal, rank 2 may not. */
export const MANAGER = "person_manager";
export const MEMBER = "person_member";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
export const API_KEY = "apikey_1";

export function makeStore(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Zoomies Dubai", status: "active" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere", status: "active" },
  ]);
  seedRows(s, "users", [
    { id: MANAGER, orgId: ORG, isActive: true, role: "manager", name: "Asha Manager", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Ravi Member", email: "ravi@example.com" },
  ]);
  return s;
}

/**
 * The ZOOMIES totals (AED, excluding VAT): Play Area 1,343,445 and Vet Area 252,835, grand 1,596,280. Five root lines that add up to
 * exactly those figures, area-prefixed categories as the multi-sheet reader writes them, and one sub-task under PLAY-1.01 whose derived
 * amount (40 % of its parent) must NOT be added again.
 */
export const ZOOMIES = { play: 1343445, vet: 252835, grand: 1596280 } as const;

export function zoomiesLines(): Row[] {
  return [
    { itemCode: "PLAY-1.01", description: "Joinery: play structure", unit: "nos", quantity: 10, rate: 65000, category: "Play Area / Joinery" }, //  650,000
    { itemCode: "PLAY-1.01.1", parentItemCode: "PLAY-1.01", breakdownPercentage: 40, description: "Joinery labour", unit: "", quantity: 0, rate: 0, category: "Play Area / Joinery" },
    { itemCode: "PLAY-2.01", description: "Flooring: rubber tiles", unit: "sqm", quantity: 250, rate: 2500, category: "Play Area / Flooring" }, //  625,000
    { itemCode: "PLAY-3.01", description: "Lump sum: glass and metal", unit: "ls", quantity: 1, rate: 68445, category: "Play Area / Lump sum" }, //   68,445
    { itemCode: "VET-1.01", description: "Clinic equipment", unit: "nos", quantity: 5, rate: 30000, category: "Vet Area / Equipment" }, //  150,000
    { itemCode: "VET-2.01", description: "Clinic fit-out", unit: "ls", quantity: 1, rate: 102835, category: "Vet Area / Fit-out" }, //  102,835
  ];
}

/** `n` distinct flat root lines, each quantity 1 x rate 100, in one area: for batch-size and duplicate tests. */
export function flatLines(n: number, prefix = "L", category = "Play Area / Bulk"): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    itemCode: `${prefix}-${String(i + 1).padStart(3, "0")}`,
    description: `Line ${i + 1}`,
    unit: "nos",
    quantity: 1,
    rate: 100,
    category,
  }));
}
