// PROJEXA server-merge Phase 0 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): ported
// verbatim from PROJEXA's own src/lib/project-list.ts (R67 D-69), which is
// deliberately NOT "use client" -- pure functions over the rows
// /api/v1/projexa/dashboard already returns, provable without a DOM.

export type ProjectRow = {
  id: string;
  name: string;
  taskCount: number;
  delayedTaskCount: number;
  /** R67 D-62's own naming: the BOQ's root-line total. null when there is no active BOQ. */
  contractValue: number | null;
  projectValue: number | null;
  projectValueSource: "entered" | "purchase_orders" | null;
  earnedValue: number | null;
  /** Whole-percent earned/contract, straight from the backend. null when there is no BOQ. */
  percentByValue: number | null;
};

export const PROJECT_STATUSES = ["delayed", "on_track", "no_tasks"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectStatusPresentation = { glyph: string; word: string; className: string };

const PRESENTATION: Record<ProjectStatus, ProjectStatusPresentation> = {
  delayed: { glyph: "●", word: "Delayed", className: "text-red-600" },
  on_track: { glyph: "✓", word: "On track", className: "text-green-700" },
  no_tasks: { glyph: "○", word: "No tasks yet", className: "text-ct-muted" },
};

export function projectStatus(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): ProjectStatus {
  if (row.delayedTaskCount > 0) return "delayed";
  return row.taskCount > 0 ? "on_track" : "no_tasks";
}

export function projectStatusPresentation(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): ProjectStatusPresentation {
  return PRESENTATION[projectStatus(row)];
}

export function projectStatusText(row: Pick<ProjectRow, "taskCount" | "delayedTaskCount">): string {
  const { glyph, word } = projectStatusPresentation(row);
  return `${glyph} ${word}`;
}

export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "delayed", label: "Delayed" },
  { value: "on_track", label: "On track" },
  { value: "no_tasks", label: "No tasks yet" },
];

export function filterProjects(rows: readonly ProjectRow[], status: string): ProjectRow[] {
  if (!status) return [...rows];
  return rows.filter((r) => projectStatus(r) === status);
}

/** Clamped to 0-100 so a backend figure outside the range cannot draw a bar past the end of its track. */
export function percentBarWidth(percentByValue: number | null): number | null {
  if (percentByValue === null || !Number.isFinite(percentByValue)) return null;
  return Math.max(0, Math.min(100, percentByValue));
}

export const PROJECT_EXPORT_HEADERS = ["Project", "% complete", "Contract value", "Project value", "Status"];

export function projectExportRows(rows: readonly ProjectRow[]): unknown[][] {
  return rows.map((r) => [
    r.name,
    r.percentByValue ?? "",
    r.contractValue ?? "",
    r.projectValue ?? "",
    projectStatusText(r),
  ]);
}
