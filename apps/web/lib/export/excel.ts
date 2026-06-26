/**
 * Excel Export Utility
 * Generates a simple .xls file using an HTML table wrapper.
 * TODO: Replace with SheetJS (xlsx) for proper .xlsx support with formatting.
 */

function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function exportToExcel(
  data: Record<string, unknown>[],
  filename: string
): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);

  const headerRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = data
    .map(
      (row) =>
        `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`
    )
    .join("");

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"></head>
<body><table border="1">
<thead><tr>${headerRow}</tr></thead>
<tbody>${bodyRows}</tbody>
</table></body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.xls`;
  link.click();

  URL.revokeObjectURL(url);
}