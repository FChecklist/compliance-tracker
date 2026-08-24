/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { clusterGaps, findEmbeddedSql, FORBIDDEN_SQL_PATTERN } from "./analyse";

describe("clusterGaps -- pure aggregation, M26's frequency >= 3 gate", () => {
  test("a phrase seen 3+ times forms a cluster, citing every real gap_log id", () => {
    const rows = [
      { id: "g1", segmentText: "approve VO-014", reason: "no executor" },
      { id: "g2", segmentText: "Approve VO-014!", reason: "no executor" },
      { id: "g3", segmentText: "  approve vo-014  ", reason: "no executor" },
    ];
    const clusters = clusterGaps(rows);
    expect(clusters.length).toBe(1);
    expect(clusters[0].frequency).toBe(3);
    expect(clusters[0].gapLogIds.sort()).toEqual(["g1", "g2", "g3"]);
  });

  test("a phrase seen only twice is dropped -- one user's one-off is not a product signal", () => {
    const rows = [
      { id: "g1", segmentText: "check the weather", reason: "no executor" },
      { id: "g2", segmentText: "check the weather", reason: "no executor" },
    ];
    expect(clusterGaps(rows)).toEqual([]);
  });

  test("different phrases never merge into one cluster", () => {
    const rows = [
      { id: "g1", segmentText: "approve VO-014", reason: "x" },
      { id: "g1b", segmentText: "approve VO-014", reason: "x" },
      { id: "g1c", segmentText: "approve VO-014", reason: "x" },
      { id: "g2", segmentText: "delete everything", reason: "x" },
      { id: "g2b", segmentText: "delete everything", reason: "x" },
      { id: "g2c", segmentText: "delete everything", reason: "x" },
    ];
    const clusters = clusterGaps(rows);
    expect(clusters.length).toBe(2);
  });

  test("empty input produces no clusters", () => {
    expect(clusterGaps([])).toEqual([]);
  });
});

describe("findEmbeddedSql + FORBIDDEN_SQL_PATTERN -- M26's SELECT-only, org-scoped guard", () => {
  test("a report_definition artifact with a real embedded query field is extracted", () => {
    const artifact = { kind: "report_definition", title: "x", definition: {}, query: "select 1" } as unknown as Parameters<typeof findEmbeddedSql>[0];
    expect(findEmbeddedSql(artifact)).toBe("select 1");
  });

  test("an artifact with no query/sql field returns null", () => {
    const artifact = { kind: "no_action", reason: "nothing to do" } as const;
    expect(findEmbeddedSql(artifact)).toBeNull();
  });

  test("SELECT-only SQL passes the forbidden-pattern check", () => {
    expect(FORBIDDEN_SQL_PATTERN.test("select count(*) from compliance.gap_log where org_id = 'x'")).toBe(false);
  });

  test("*** THE REQUIRED GUARD: any DML/DDL keyword is caught, case-insensitively ***", () => {
    for (const bad of [
      "INSERT INTO compliance.gap_log values (1)",
      "update compliance.projects set name = 'x'",
      "DELETE FROM compliance.tasks",
      "DROP TABLE compliance.submissions",
      "ALTER TABLE compliance.gap_log ADD COLUMN x text",
      "TRUNCATE compliance.gap_log",
      "CREATE TABLE evil (id text)",
      "GRANT ALL ON compliance.gap_log TO public",
      "REVOKE ALL ON compliance.gap_log FROM app_runtime",
    ]) {
      expect(FORBIDDEN_SQL_PATTERN.test(bad)).toBe(true);
    }
  });
});
