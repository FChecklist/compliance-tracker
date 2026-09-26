// PROJEXA-BUILD-002 WP-05g and WP-05h -- what the wave 7 test (coverage-wave7.test.ts) and the wave 8 and 9 test (coverage-wave8-9.test.ts) share on top of
// coverage-fixtures.ts: the records the new functions read, and a database double that also answers the one relational read the KPI service makes
// (`with: { definition: true }`), which boq-store-double.ts does not model. Lives in __test-helpers__ for the reason pipeline-store-double.ts does.
import { eq } from "drizzle-orm";
import { constructionKpiDefinitions } from "@/lib/db/schema";
import { seedRows, type BoqStore } from "./boq-store-double";
import { coverageWithTenantContext, MANAGER, MEMBER, OTHER_ORG, ORG, PROJECT_A, PROJECT_B, PROJECT_X } from "./coverage-fixtures";

/** The client the fixture gives project A, and the customers around it. */
export const CLIENT_A = "client_a";
export const CUSTOMER_A = "cust_a"; // linked to project A's client
export const CUSTOMER_EARLIER = "cust_earlier"; // no client link, but billed on an earlier claim of project A
export const CUSTOMER_OTHER = "cust_other"; // an organisation customer project A does not bill
export const CUSTOMER_GONE = "cust_gone"; // linked to the client but no longer active

/** Wave 7: BOQs, claims (one in each state), customers, change orders, KPI definitions and entries, each with a record of project B to be refused. */
export function seedWave7Records(s: BoqStore): void {
  // project A now names a client, the way a real project does
  const projectA = s.tables.projects.find((p) => p.id === PROJECT_A)!;
  projectA.clientId = CLIENT_A;
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, status: "draft" },
    { id: "boq_a_sent", orgId: ORG, projectId: PROJECT_A, version: 2, status: "submitted" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "draft" },
  ]);
  seedRows(s, "erp_customers", [
    { id: CUSTOMER_A, orgId: ORG, customerName: "Zoomies Trading LLC", clientId: CLIENT_A, isActive: true },
    { id: CUSTOMER_EARLIER, orgId: ORG, customerName: "Earlier Customer", isActive: true },
    { id: CUSTOMER_OTHER, orgId: ORG, customerName: "Somebody Else Ltd", clientId: "client_other", isActive: true },
    { id: CUSTOMER_GONE, orgId: ORG, customerName: "Closed Customer", clientId: CLIENT_A, isActive: false },
  ]);
  seedRows(s, "construction_progress_claims", [
    { id: "claim_a", orgId: ORG, projectId: PROJECT_A, boqId: "boq_a", customerId: CUSTOMER_EARLIER, milestoneDescription: "Mobilisation", scheduledDate: "2026-09-01", status: "milestone_achieved", createdById: MEMBER },
    { id: "claim_a_drafted", orgId: ORG, projectId: PROJECT_A, boqId: "boq_a", customerId: CUSTOMER_A, milestoneDescription: "Structure", scheduledDate: "2026-09-10", status: "drafted", createdById: MEMBER },
    { id: "claim_a_submitted", orgId: ORG, projectId: PROJECT_A, boqId: "boq_a", customerId: CUSTOMER_A, milestoneDescription: "Finishes", scheduledDate: "2026-09-20", status: "submitted", createdById: MEMBER },
    { id: "claim_b", orgId: ORG, projectId: PROJECT_B, boqId: "boq_b", customerId: CUSTOMER_OTHER, milestoneDescription: "Other project", scheduledDate: "2026-09-01", status: "milestone_achieved", createdById: MEMBER },
  ]);
  seedRows(s, "construction_change_orders", [
    { id: "co_a", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Extra partition", costImpact: "12000", scheduleImpactDays: 3, status: "draft", requestedById: MEMBER },
    { id: "co_a_sent", orgId: ORG, projectId: PROJECT_A, number: 2, title: "Already sent", costImpact: "500", status: "pending_approval", requestedById: MEMBER },
    { id: "co_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Other project", costImpact: "900", status: "draft", requestedById: MEMBER },
  ]);
  seedRows(s, "construction_kpi_definitions", [
    { id: "kpi_a", orgId: ORG, projectId: PROJECT_A, metricName: "Snag closure rate", unit: "%", period: "monthly" },
    { id: "kpi_b", orgId: ORG, projectId: PROJECT_B, metricName: "Other project KPI", unit: "%", period: "monthly" },
    { id: "kpi_org", orgId: ORG, projectId: null, metricName: "Designer utilisation", unit: "%", period: "monthly" },
    { id: "kpi_x", orgId: OTHER_ORG, projectId: PROJECT_X, metricName: "Elsewhere", unit: "%", period: "monthly" },
  ]);
  seedRows(s, "construction_kpi_entries", [
    { id: "kentry_a", kpiDefinitionId: "kpi_a", period: "2026-08", actualValue: "80", filledById: MEMBER, approvalStatus: "submitted" },
    { id: "kentry_a_mine", kpiDefinitionId: "kpi_a", period: "2026-07", actualValue: "70", filledById: MANAGER, approvalStatus: "submitted" },
    { id: "kentry_a_done", kpiDefinitionId: "kpi_a", period: "2026-06", actualValue: "60", filledById: MEMBER, approvalStatus: "approved" },
    { id: "kentry_b", kpiDefinitionId: "kpi_b", period: "2026-08", actualValue: "50", filledById: MEMBER, approvalStatus: "submitted" },
    { id: "kentry_org", kpiDefinitionId: "kpi_org", period: "2026-08", actualValue: "40", filledById: MEMBER, approvalStatus: "submitted" },
    { id: "kentry_x", kpiDefinitionId: "kpi_x", period: "2026-08", actualValue: "30", filledById: MEMBER, approvalStatus: "submitted" },
  ]);
}

/** Waves 8 and 9: documents, wiki pages, mood boards, FF&E items, floor plans and rooms, each with a record of project B to be refused. */
export function seedWave89Records(s: BoqStore): void {
  seedRows(s, "documents", [
    { id: "doc_a", orgId: ORG, name: "Fit-out permit", fileUrl: "https://example.com/permit.pdf", category: "permit", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: { isExternalLink: true, permitNumber: "FO-1" } },
    { id: "doc_a_meta", orgId: ORG, name: "AR-101 plan", fileUrl: "https://example.com/ar101.pdf", category: "drawing", linkedEntityType: "permit", linkedEntityId: "permit_x", metadata: { isExternalLink: true, projectId: PROJECT_A } },
    { id: "doc_b", orgId: ORG, name: "Other project permit", fileUrl: "https://example.com/other.pdf", category: "permit", linkedEntityType: "project", linkedEntityId: PROJECT_B, metadata: { isExternalLink: true } },
    { id: "doc_none", orgId: ORG, name: "Loose file", fileUrl: "https://example.com/loose.pdf", category: "other", metadata: { isExternalLink: true } },
  ]);
  seedRows(s, "pms_wiki_pages", [
    { id: "wiki_a", orgId: ORG, projectId: PROJECT_A, slug: "site-rules", title: "Site rules", content: "Hard hats.", version: 1, isArchived: false },
    { id: "wiki_a_old", orgId: ORG, projectId: PROJECT_A, slug: "old-page", title: "Old page", content: "Gone.", version: 3, isArchived: true },
    { id: "wiki_b", orgId: ORG, projectId: PROJECT_B, slug: "other-rules", title: "Other rules", content: "Elsewhere.", version: 1, isArchived: false },
  ]);
  seedRows(s, "interior_mood_boards", [
    { id: "mb_a", orgId: ORG, projectId: PROJECT_A, title: "Living room", status: "draft", createdById: MEMBER },
    { id: "mb_b", orgId: ORG, projectId: PROJECT_B, title: "Other project board", status: "draft", createdById: MEMBER },
  ]);
  seedRows(s, "interior_ffe_items", [
    { id: "ffe_a", orgId: ORG, projectId: PROJECT_A, itemName: "Sofa", category: "furniture", quantity: 2, unitCost: "1000", unitPrice: "1500", status: "specified", createdById: MEMBER },
    { id: "ffe_a2", orgId: ORG, projectId: PROJECT_A, itemName: "Pendant light", category: "lighting", quantity: 3, unitCost: "200", unitPrice: "300", status: "specified", createdById: MEMBER },
    { id: "ffe_b", orgId: ORG, projectId: PROJECT_B, itemName: "Other project chair", category: "furniture", quantity: 1, unitCost: "50", unitPrice: "80", status: "specified", createdById: MEMBER },
  ]);
  seedRows(s, "interior_floor_plans", [
    { id: "fp_a", orgId: ORG, projectId: PROJECT_A, name: "Level 1", status: "draft", createdById: MEMBER },
    { id: "fp_b", orgId: ORG, projectId: PROJECT_B, name: "Other level", status: "draft", createdById: MEMBER },
  ]);
  seedRows(s, "interior_floor_plan_rooms", [
    { id: "room_a", floorPlanId: "fp_a", name: "Lounge", polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }], ceilingHeightCm: "270", sortOrder: 0 },
    { id: "room_b", floorPlanId: "fp_b", name: "Other room", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], ceilingHeightCm: "270", sortOrder: 0 },
  ]);
}

/**
 * The relational read approveKpiEntry() makes: `findFirst({ where, with: { definition: true } })` on a KPI entry. The double reads the
 * entry, then the definition it points at, from the same fixture rows and the same transaction.
 */
function withKpiRelation(db: any): unknown {
  const query = new Proxy(db.query, {
    get: (target, key) => {
      const table = target[key];
      if (key !== "constructionKpiEntries") return table;
      return {
        ...table,
        findFirst: async (cfg: { where?: unknown; with?: { definition?: boolean } } = {}) => {
          const entry = await table.findFirst({ where: cfg.where });
          if (!entry || !cfg.with?.definition) return entry;
          const definition = await db.query.constructionKpiDefinitions.findFirst({ where: eq(constructionKpiDefinitions.id, entry.kpiDefinitionId) });
          return { ...entry, definition };
        },
      };
    },
  });
  return { ...db, query };
}

/** The withTenantContext stand-in of the wave 7, 8 and 9 tests: coverage-fixtures' double plus the KPI relation. */
export function w79WithTenantContext(getStore: () => BoqStore) {
  const base = coverageWithTenantContext(getStore);
  return (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => base(ctx, (db) => fn(withKpiRelation(db)));
}
