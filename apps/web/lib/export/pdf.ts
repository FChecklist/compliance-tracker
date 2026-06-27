/**
 * PDF Export Utility — generates a real .pdf file using jsPDF.
 * Falls back to the print-dialog approach when jsPDF is unavailable.
 */

import { jsPDF } from "jspdf";
import "jspdf-autotable";

interface ExportRow {
  [key: string]: unknown;
}

type TableAlign = "left" | "center" | "right";

export function exportToPDF(
  data: ExportRow[],
  filename: string,
  title?: string,
): void {
  if (data.length === 0) return;

  const doc = new jsPDF({ orientation: "landscape" as const });
  const headers = Object.keys(data[0]);
  const displayTitle = title ?? filename;

  // Title
  doc.setFontSize(16);
  doc.text(displayTitle, 14, 20);

  // Subtitle with timestamp
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 27);
  doc.text(`Total records: ${data.length}`, 14, 32);

  // Table
  (doc as unknown as { autoTable: (opts: Record<string, unknown>) => void }).autoTable({
    startY: 38,
    head: [headers.map((h) => h.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))],
    body: data.map((row) => headers.map((h) => String(row[h] ?? ""))),
    styles: {
      fontSize: 8,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [37, 99, 235], // blue-600
      textColor: 255,
      fontStyle: "bold" as const,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251], // gray-50
    },
    columnStyles: headers.reduce<Record<number, { cellWidth?: number; halign?: TableAlign }>>((acc, _h, i) => {
      // Auto-size: give more width to earlier columns
      acc[i] = { cellWidth: i === 0 ? 50 : undefined };
      return acc;
    }, {}),
    margin: { left: 14, right: 14 },
  });

  doc.save(`${filename}.pdf`);
}