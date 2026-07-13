"use client";

// PPTX/Word/HTML report export (2026-07-13, Owner request: "report
// templates in PDF/Excel/HTML/PPT/Word/CSV -- currently only PDF/Excel/CSV
// exist"). Deliberately a separate lib module, not new code inline in
// reports/page.tsx -- a parallel agent is also touching that page (adding a
// catalog-list section) this same wave, so keeping the new export logic
// here and having the page just import+wire buttons keeps both agents'
// diffs additive and low-conflict.
//
// All three functions below consume exactly the same `ExportRow[]` shape
// reports/page.tsx's buildExportRows() already produces for the existing
// CSV/Excel/PDF exports (PR #104/WAVE-156's "shared row builder so all
// exports use identical columns/data") -- there is no second, forked
// data-shaping path here. Callers must pass buildExportRows()'s output
// directly; this file does no DB/API access of its own.
import { format } from "date-fns";

export type ExportRow = Record<string, string | number>;

export type ExportMeta = {
  /** Report title shown on the title slide/page/doc. Defaults to the VERIDIAN compliance report title. */
  title?: string;
  /** Downloaded file name prefix, before "-YYYY-MM-DD.ext". */
  fileNamePrefix?: string;
};

function downloadName(prefix: string, ext: string): string {
  return `${prefix}-${format(new Date(), "yyyy-MM-dd")}.${ext}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PPTX Export (pptxgenjs) ────────────────────────────────────────────
// Title slide + paginated table slides (18 rows/slide keeps text legible
// instead of crushing a few hundred compliance items onto one slide).
// Dynamic import keeps pptxgenjs out of the initial reports/page.tsx bundle
// -- it's only ever needed once a user actually clicks "Export PPT".
export async function exportPPTX(rows: ExportRow[], meta: ExportMeta = {}) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  const title = meta.title ?? "VERIDIAN Compliance Report";
  const generatedAt = format(new Date(), "yyyy-MM-dd HH:mm");
  const headers = Object.keys(rows[0] ?? {});

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "FFFDF9" };
  titleSlide.addText(title, {
    x: 0.5, y: 2.0, w: 9, h: 1.1, fontSize: 30, bold: true, color: "1C2B3A", fontFace: "Arial",
  });
  titleSlide.addText(`Generated: ${generatedAt}\nTotal Items: ${rows.length}`, {
    x: 0.5, y: 3.1, w: 9, h: 0.8, fontSize: 14, color: "64748B",
  });

  if (rows.length === 0) {
    const slide = pptx.addSlide();
    slide.addText("No data available.", { x: 0.5, y: 2.5, w: 9, h: 1, fontSize: 16, color: "64748B" });
  }

  const ROWS_PER_SLIDE = 18;
  for (let i = 0; i < rows.length; i += ROWS_PER_SLIDE) {
    const chunk = rows.slice(i, i + ROWS_PER_SLIDE);
    const slide = pptx.addSlide();
    slide.addText(`${title} (${i + 1}-${i + chunk.length} of ${rows.length})`, {
      x: 0.3, y: 0.2, w: 9.4, h: 0.4, fontSize: 13, bold: true, color: "1C2B3A",
    });
    const colW = headers.map(() => 9.4 / Math.max(headers.length, 1));
    const tableRows = [
      headers.map((h) => ({ text: h, options: { bold: true, fill: { color: "1C2B3A" }, color: "FFFFFF", fontSize: 9 } })),
      ...chunk.map((row) => headers.map((h) => ({ text: String(row[h] ?? ""), options: { fontSize: 8, color: "1C2B3A" } }))),
    ];
    slide.addTable(tableRows, {
      x: 0.3, y: 0.7, w: 9.4, colW,
      border: { type: "solid", color: "E2E8F0", pt: 0.5 },
      autoPage: true,
    });
  }

  await pptx.writeFile({ fileName: downloadName(meta.fileNamePrefix ?? "compliance-report", "pptx") });
}

// ─── Word Export (docx) ─────────────────────────────────────────────────
// Same rows -> a single-page-flow document: title, metadata, then a real
// Word table (not an image/screenshot), matching the "real, editable
// export" bar the existing Excel/CSV exports already set.
export async function exportDocx(rows: ExportRow[], meta: ExportMeta = {}) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, ShadingType } = await import("docx");
  const title = meta.title ?? "VERIDIAN Compliance Report";
  const generatedAt = format(new Date(), "yyyy-MM-dd HH:mm");
  const headers = Object.keys(rows[0] ?? {});

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "1C2B3A" },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 18 })] })],
        })
    ),
  });
  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: headers.map(
          (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(row[h] ?? ""), size: 18 })] })] })
        ),
      })
  );

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: `Generated: ${generatedAt}`, color: "64748B", size: 18 })] }),
          new Paragraph({ children: [new TextRun({ text: `Total Items: ${rows.length}`, color: "64748B", size: 18 })] }),
          new Paragraph({ text: "" }),
          rows.length > 0
            ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] })
            : new Paragraph({ text: "No data available." }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerBlobDownload(blob, downloadName(meta.fileNamePrefix ?? "compliance-report", "docx"));
}

// ─── HTML Export (no new dependency) ────────────────────────────────────
// A standalone, self-contained styled .html file -- opens correctly with
// no server/app, just double-click. Built from the exact same rows as
// every other export, so a diff between the HTML and Excel/CSV export of
// the same click is never possible.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function exportHTML(rows: ExportRow[], meta: ExportMeta = {}) {
  const title = meta.title ?? "VERIDIAN Compliance Report";
  const generatedAt = format(new Date(), "yyyy-MM-dd HH:mm");
  const headers = Object.keys(rows[0] ?? {});
  const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyHtml = rows
    .map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(String(row[h] ?? ""))}</td>`).join("")}</tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; margin: 2rem; color: #1C2B3A; background: #FFFDF9; }
  h1 { font-family: Georgia, 'DM Serif Display', serif; margin-bottom: 0.25rem; }
  .meta { color: #64748B; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; background: #fff; }
  th, td { border: 1px solid #E2E8F0; padding: 8px 10px; text-align: left; }
  th { background: #1C2B3A; color: #fff; position: sticky; top: 0; }
  tr:nth-child(even) { background: #F8FAFC; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated: ${escapeHtml(generatedAt)} &nbsp;|&nbsp; Total Items: ${rows.length}</p>
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${rows.length ? bodyHtml : `<tr><td colspan="${headers.length || 1}">No data available.</td></tr>`}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  triggerBlobDownload(blob, downloadName(meta.fileNamePrefix ?? "compliance-report", "html"));
}
