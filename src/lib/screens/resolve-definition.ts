// R42 seq20 (M28/M31 S1) -- load + resolve a screen_definitions row.
//
// "A function is a row, not a folder" (M28): loading a screen is one lookup,
// never a per-module file. Org rows OVERRIDE the global row for the same
// function_id when present (M28's reuse mechanism) -- most functions have
// only a global row; an org-specific row is the escape hatch for a
// genuinely per-tenant customisation, not the common case.
import { and, eq, isNull, or } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { screenDefinitions } from "@/lib/db/schema";

export type FieldStatus = "REQUIRED" | "OPTIONAL" | "SUPPRESSED";
export type ScreenColumn = {
  label: string;
  field: string;
  type: string;
  control?: string;
  optionsSource?: string;
  defaultValue?: unknown;
  required?: boolean;
  unit?: string;
  importance?: "High" | "Medium" | "Low";
  derivedFrom?: string;
  fieldStatus?: FieldStatus;
  inheritsFromHeader?: boolean;
  level?: "org" | "header" | "item" | "schedule"; // M31's four document levels
};

export type ScreenAction = { label: string; kind: string; enabledWhen?: string };

export type ResolvedScreenDefinition = {
  id: string;
  orgId: string | null;
  functionId: string;
  archetype: "LIST" | "OBJECT" | "FORM" | "DASHBOARD" | "REPORT" | "TIMELINE" | "COMPARE" | "CUSTOM";
  customComponent: string | null;
  dataSource: string;
  columns: ScreenColumn[];
  filters: unknown;
  actions: ScreenAction[] | null;
  drillTo: string | null;
  breadcrumbTemplate: string | null;
  flowParent: string | null;
  flowChildren: string[] | null;
  createWithReference: string | null;
  version: number;
  /** true when an org-specific row was found and used instead of the global row. */
  isOrgOverride: boolean;
};

/**
 * Resolves a screen_definitions row for (orgId, functionId): the org's own
 * row wins if one exists, else the global (org_id IS NULL) row, else null
 * (M28: "if a column named there does not exist in data_source, the screen
 * must FAIL LOUDLY AT LOAD" -- that check belongs to the archetype component
 * that actually reads data_source, seq21+; this function's job stops at
 * resolving which definition row applies).
 */
export async function resolveScreenDefinition(orgId: string, functionId: string): Promise<ResolvedScreenDefinition | null> {
  return withTenantContext({ orgId }, async (db) => {
    const rows = await db.query.screenDefinitions.findMany({
      where: and(eq(screenDefinitions.functionId, functionId), or(eq(screenDefinitions.orgId, orgId), isNull(screenDefinitions.orgId))),
    });
    if (rows.length === 0) return null;

    const orgRow = rows.find((r) => r.orgId === orgId);
    const globalRow = rows.find((r) => r.orgId === null);
    const row = orgRow ?? globalRow;
    if (!row) return null;

    return {
      id: row.id,
      orgId: row.orgId,
      functionId: row.functionId,
      archetype: row.archetype,
      customComponent: row.customComponent,
      dataSource: row.dataSource,
      columns: (row.columns as ScreenColumn[]) ?? [],
      filters: row.filters,
      actions: (row.actions as ScreenAction[] | null) ?? null,
      drillTo: row.drillTo,
      breadcrumbTemplate: row.breadcrumbTemplate,
      flowParent: row.flowParent,
      flowChildren: (row.flowChildren as string[] | null) ?? null,
      createWithReference: row.createWithReference,
      version: row.version,
      isOrgOverride: !!orgRow,
    };
  });
}
