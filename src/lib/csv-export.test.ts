/// <reference types="bun-types" />
// Ported verbatim from PROJEXA's own src/lib/csv-export.test.ts alongside
// csv-export.ts (PROJEXA server-merge Phase 0). Every assertion here is a
// defect the hand-rolled `[a, b].join(",")` exports would actually have.
import { describe, expect, test } from "bun:test";
import { csvEscape, csvFilename, toCsv } from "./csv-export";

describe("csvEscape", () => {
  test("a value containing a comma is quoted so the following columns do not shift", () => {
    expect(csvEscape("Ali Hassan, Jr")).toBe('"Ali Hassan, Jr"');
    expect(csvEscape("Cedar Heights, Phase 1")).toBe('"Cedar Heights, Phase 1"');
  });

  test("an embedded double quote is doubled, per RFC 4180", () => {
    expect(csvEscape('Steel 12" rebar')).toBe('"Steel 12"" rebar"');
    expect(csvEscape('He said "no"')).toBe('"He said ""no"""');
  });

  test("a newline inside a cell is quoted rather than ending the row", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });

  test("a value that Excel would run as a formula is prefixed so it stays text", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+44 7700 900000")).toBe("'+44 7700 900000");
    expect(csvEscape("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvEscape("-5")).toBe("'-5");
    expect(csvEscape("-25")).toBe("'-25");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("@handle")).toBe("'@handle");
  });

  test("a formula that also needs quoting gets both treatments", () => {
    expect(csvEscape("=A1,B2")).toBe(`"'=A1,B2"`);
  });

  test("null and undefined are empty cells, not the words 'null'/'undefined'", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  test("ordinary values are untouched", () => {
    expect(csvEscape("Ali Hassan")).toBe("Ali Hassan");
    expect(csvEscape("DEWA permit 2026.pdf")).toBe("DEWA permit 2026.pdf");
    expect(csvEscape(300)).toBe("300");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(0)).toBe("0");
  });
});

describe("toCsv", () => {
  test("writes the header row then the data rows, CRLF separated", () => {
    const csv = toCsv(["S.No", "Name", "Daily Rate"], [[1, "Ali Hassan", 300], [2, "Bina, Rao", 250]]);
    expect(csv).toBe('S.No,Name,Daily Rate\r\n1,Ali Hassan,300\r\n2,"Bina, Rao",250');
  });

  test("header row first, then one line per row, in column order", () => {
    const csv = toCsv(
      ["Name", "Category", "Relates to"],
      [
        ["DEWA permit 2026.pdf", "permit", "Permit — BP-2026-0142"],
        ["Site photo, north face", "site photo", "—"],
      ]
    );
    expect(csv.split("\r\n")).toEqual([
      "Name,Category,Relates to",
      "DEWA permit 2026.pdf,permit,Permit — BP-2026-0142",
      '"Site photo, north face",site photo,—',
    ]);
  });

  test("an empty row set still writes the header, so the file is never zero bytes", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
    expect(toCsv(["Name"], [])).toBe("Name");
  });
});

describe("csvFilename", () => {
  test("slugs a real project name into something a browser and Windows will keep", () => {
    expect(csvFilename("roster", "Cedar Heights Villa - Phase 1", "2026-09-03"))
      .toBe("roster-cedar-heights-villa-phase-1-2026-09-03.csv");
  });

  test("a name made entirely of punctuation still yields a usable filename", () => {
    expect(csvFilename("roster", "///", "2026-09-03")).toBe("roster-export-2026-09-03.csv");
  });
});
