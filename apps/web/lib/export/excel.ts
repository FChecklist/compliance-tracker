/**
 * Excel Export Utility — generates a real .xlsx file using SheetJS.
 */

import * as XLSX from "xlsx";

interface ExportRow {
  [key: string]: unknown;
}

export function exportToExcel(
  data: ExportRow[],
  filename: string,
): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);

  // Build worksheet: header row + data rows
  const wsData = [
    // Header row with formatted column names
    headers.map((h) => h.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())),
    // Data rows
    ...data.map((row) => headers.map((h) => row[h] ?? "")),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-size column widths based on content
  ws["!cols"] = headers.map((h) => {
    const maxLen = Math.max(
      h.length,
      ...data.slice(0, 50).map((r) => String(r[h] ?? "").length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });

  // Freeze the header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compliance Data");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}