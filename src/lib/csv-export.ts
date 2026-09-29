// PROJEXA server-merge Phase 0 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): ported
// verbatim from PROJEXA's own src/lib/csv-export.ts (R67, lane D1 x D3
// merge). compliance-tracker's own src/lib/report-export-shared.ts already
// has a server-side csvEscape()/rowsToCSV() pair for API-route responses,
// but nothing that triggers a browser download from rows already on
// screen -- that's what downloadCsv() here is for. Kept as its own module
// (not folded into report-export-shared.ts) because this one is
// browser-only (DOM APIs) while that one is deliberately server-safe; the
// escaping rules are equivalent, just phrased differently (an explicit
// FORMULA_TRIGGERS list here vs a regex there).

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * RFC 4180 quoting plus the formula-injection guard: a value starting with
 * = + - @ (or a tab/CR, which some spreadsheets strip before parsing) is
 * prefixed with a single quote so it is read as text, never evaluated.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (text.length > 0 && FORMULA_TRIGGERS.includes(text[0])) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Header row + data rows, CRLF-separated (the line ending Excel expects). */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/** Builds a filename like `roster-cedar-heights-villa-phase-1-2026-09-03.csv`. */
export function csvFilename(prefix: string, label: string, isoDate: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";
  return `${prefix}-${slug}-${isoDate}.csv`;
}

/** Browser-only: hands the built CSV to the user as a download. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM keeps Excel from mangling non-ASCII names without affecting any other reader.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
