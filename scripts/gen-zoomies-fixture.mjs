// Generates src/lib/ingest/__fixtures__/zoomies-digest.json from the raw ZOOMIES prospect workbook (PROJEXA-BUILD-002, WP-01).
//
// The workbook is a client document: it holds the contractor's address and phone number, the payment terms with bank
// account details, and the client's company name. It is never committed. This script reads it from the local disk, keeps the
// sheet structure, descriptions, units, quantities, rates and subtotals (what the multi-sheet bill reader needs), drops
// every row that carries contact or bank details, removes the client's company name from the project title, and refuses to
// write the file if any sensitive marker is left. The JSON it writes is what CI tests use.
//
// The workbook is read with readWorkbookGrid() from src/lib/ingest/parser.ts (the reader the scope import uses), so the
// fixture holds exactly the cell text the reader will see for the real file.
//
// USAGE   bun scripts/gen-zoomies-fixture.mjs [path-to-workbook]
//         default path: C:\Users\Dell\Downloads\SMD.ZOOMIES, DIP, FP.DUBAI signed.xlsx  (read only, never modified)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readWorkbookGrid } from "../src/lib/ingest/parser.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = process.argv[2] ?? "C:\\Users\\Dell\\Downloads\\SMD.ZOOMIES, DIP, FP.DUBAI signed.xlsx"
const OUT = resolve(HERE, "../src/lib/ingest/__fixtures__/zoomies-digest.json")

// A row is dropped when any of its cells starts a contractor block, the notes or the terms and payment block.
const DROP_ROW = /^(contractor\b|notes\s*:|terms\s*&|terms and)/i
// Anything that must not survive into the committed file.
const FORBIDDEN = /iban|a\/c|account|bank|swift|tel\.?\s*no|phone|p\.?\s?o\.?\s?box|@|www\.|\bl\.l\.c\b|\bllc\b|\bfz\b|adcb|signed by|accepted by|yours faithfully/i

const grid = await readWorkbookGrid(readFileSync(SOURCE))

let droppedRows = 0
let renamedCells = 0
const sheets = grid.sheets.map((sheet) => ({
  name: sheet.name,
  rows: sheet.rows
    .filter((r) => {
      const drop = r.cells.some((c) => DROP_ROW.test(c.trim()))
      if (drop) droppedRows++
      return !drop
    })
    .map((r) => ({
      row: r.row,
      // The client's company name sits in the project title ("<job no> <trade name> - <company> L.L.C , <place>").
      cells: r.cells.map((c) => {
        if (!/\bl\.l\.c\b/i.test(c)) return c
        renamedCells++
        return c.replace(/\s+-\s+[^\n]*?\bl\.l\.c\b/i, "")
      }),
    }))
    .filter((r) => r.cells.some((c) => c !== "")),
}))

const lines = ['{"sheets":[']
sheets.forEach((s, i) => {
  lines.push(`{"name":${JSON.stringify(s.name)},"rows":[`)
  s.rows.forEach((r, j) => lines.push(`${JSON.stringify(r)}${j < s.rows.length - 1 ? "," : ""}`))
  lines.push(`]}${i < sheets.length - 1 ? "," : ""}`)
})
lines.push("]}")
const json = lines.join("\n") + "\n"

const leak = json.match(FORBIDDEN)
if (leak) {
  console.error(`REFUSED: the fixture still holds a sensitive marker: ${JSON.stringify(leak[0])}`)
  process.exit(1)
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, json)
const rows = sheets.reduce((n, s) => n + s.rows.length, 0)
console.log(`wrote ${OUT}: ${sheets.length} sheets, ${rows} rows, ${droppedRows} rows dropped, ${renamedCells} cells renamed, ${json.length} bytes`)
