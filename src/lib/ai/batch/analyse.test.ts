/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { clusterGaps, findEmbeddedSql, FORBIDDEN_SQL_PATTERN, toReportDefinitionInput } from "./analyse";

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

describe("toReportDefinitionInput -- R46 P9 seq33: report_definition artifacts becoming real, runnable rows", () => {
  test("a deterministic_aggregation artifact with a real TABLE_REGISTRY tableKey maps to an insertable input", () => {
    const artifact = {
      kind: "report_definition" as const,
      title: "Open compliance items by status",
      definition: {
        classifications: ["compliance"],
        description: "Count of open compliance items grouped by status.",
        executionType: "deterministic_aggregation",
        executionConfig: { kind: "aggregation", tableKey: "compliance_items", groupByColumn: "status", aggregation: "count" },
      },
    };
    const input = toReportDefinitionInput(artifact, "l2_batch:gap_log:g1,g2,g3");
    expect(input).not.toBeNull();
    expect(input?.executionType).toBe("deterministic_aggregation");
    expect(input?.category).toBe("ai_new_report_promoted");
    expect(input?.createdBy).toBe("ai");
    expect(input?.status).toBe("built");
    expect(input?.promotedFromContext).toBe("l2_batch:gap_log:g1,g2,g3");
  });

  test("an ai_recipe artifact is rejected (never auto-promoted without a human reviewer)", () => {
    const artifact = {
      kind: "report_definition" as const,
      title: "Narrative risk summary",
      definition: { executionType: "ai_recipe", executionConfig: { kind: "ai_recipe", promptKey: "x", groundingNote: "x" } },
    };
    expect(toReportDefinitionInput(artifact, "l2_batch:gap_log:g1")).toBeNull();
  });

  test("a tableKey that isn't in the real TABLE_REGISTRY whitelist is rejected", () => {
    const artifact = {
      kind: "report_definition" as const,
      title: "Bogus table report",
      definition: {
        executionType: "deterministic_aggregation",
        executionConfig: { kind: "aggregation", tableKey: "not_a_real_table", aggregation: "count" },
      },
    };
    expect(toReportDefinitionInput(artifact, "l2_batch:gap_log:g1")).toBeNull();
  });

  test("a missing executionConfig is rejected", () => {
    const artifact = {
      kind: "report_definition" as const,
      title: "No config",
      definition: { executionType: "deterministic_aggregation" },
    };
    expect(toReportDefinitionInput(artifact, "l2_batch:gap_log:g1")).toBeNull();
  });
});
