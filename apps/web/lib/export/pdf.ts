/**
 * PDF Export Utility
 * Opens a print-friendly window that the user can save as PDF.
 * TODO: Replace with jsPDF for direct PDF generation without print dialog.
 */

function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function exportToPDF(
  data: Record<string, unknown>[],
  filename: string,
  title?: string
): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);

  const headerRow = headers
    .map((h) => `<th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;font-weight:600;text-align:left">${escapeHtml(h)}</th>`)
    .join("");

  const bodyRows = data
    .map(
      (row, idx) =>
        `<tr style="background:${idx % 2 === 0 ? "#fff" : "#fafafa"}">${headers
          .map((h) => `<td style="border:1px solid #ddd;padding:8px">${escapeHtml(row[h])}</td>`)
          .join("")}</tr>`
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title ?? filename}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}h1{font-size:18px;margin-bottom:16px}</style>
</head><body>
<h1>${title ?? filename}</h1>
<p style="color:#666;font-size:13px;margin-bottom:16px">Generated: ${new Date().toLocaleString("en-IN")}</p>
<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
}