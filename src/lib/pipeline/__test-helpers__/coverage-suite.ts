/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05c/WP-05d -- the checks every function of a coverage wave must pass, written once and registered for each function
// of the wave's table (coverage-wave3.test.ts, coverage-wave4.test.ts). Each file adds the checks that are specific to one function
// (what the row looks like after a valid call, the trap that function has) next to this suite.
//
// WHAT EVERY FUNCTION IS HELD TO
//   registry     the generated link policy says what the wave's table says: level, minimum rank, money flag, required parameters, free-text
//                parameters, and every id parameter is one the link declares as an id;
//   link         through the REAL Edge handler: the valid parameters are a valid check on a manager's link; a level-0 function is not an
//                action; a level-1 function passes the direct path (the answer is 503, changes are not switched on, never 403 or 422); a
//                level-2 function is refused on the direct path (403 LEVEL_NOT_ALLOWED) and is a proposal (a draft) for the person to
//                confirm; a viewer's link does not carry it, and a member's does not carry a manager-rank function; a missing required
//                parameter is 422 on the direct path and is named in `missing` on a check; another project's id in `projectId` is 403;
//   executor     a missing required parameter is a failure that names it, and nothing is written; a params.projectId that names another
//                project is PROJECT_NOT_REACHABLE; a role below the minimum rank, and a task with no role, is refused (NOT_PERMITTED); a write
//                that names no person is refused; an id of another project, of another organisation or of no record at all reads as absent
//                (RECORD_NOT_FOUND) and the store is byte-identical afterwards;
//   free text    every text parameter the policy lists is treated as free text by the rule a link submission gets (run-submission's
//                withLinkText: a card `text` field): 2,000 characters pass, 2,001 are refused with TEXT_TOO_LONG, control characters and
//                backtick runs are removed; and the link's own check reports an over-long text.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyLinkTextRules, AI_LINK_TEXT_MAX } from "../ai-link-text";
import { functionSpec } from "../function-registry";
import { executeRead } from "../execute-read";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { API_KEY, linkHarness, MANAGER, ORG, PROJECT_A, PROJECT_B, snapshot, TOKENS } from "./coverage-fixtures";
import type { BoqStore, Row } from "./boq-store-double";

export type Case = {
  fn: string;
  level: 0 | 1 | 2;
  minRank: 2 | 3;
  money: boolean;
  /** parameters that succeed, without projectId */
  valid: Row;
  /** the required parameters (not projectId) with the key `missing` must name when one is absent */
  required: Array<[param: string, missingKey: string]>;
  /** the free-text parameters the link policy lists */
  text: string[];
  /** id parameters: the name, a value that names a record of another project, and (default "no_such_record") a value that names no record */
  foreign: Array<[param: string, value: unknown] | [param: string, value: unknown, absent: unknown]>;
};

export type Registry = {
  function_id: string; kind: string; link_level: number | null; min_role_rank: number; money_sensitive: boolean; text_params: string[]
  declared_params: string[]; id_params: string[]; required_params: Array<{ name: string; any_of: string[] }>
};
export const REGISTRY = JSON.parse(readFileSync(new URL("../../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as Registry[];
export const fnRow = (id: string) => REGISTRY.find((f) => f.function_id === id)!;

export type Deps = {
  execute: (task: ExecutableTask) => Promise<ExecutionOutcome>;
  store: () => BoqStore;
};

export const task = (functionId: string, params: Row = {}, over: Partial<ExecutableTask> = {}): ExecutableTask => ({
  orgId: ORG,
  userId: API_KEY,
  projectId: PROJECT_A,
  functionId,
  params,
  role: "manager",
  actorUserId: MANAGER,
  ...over,
});

/** The failure of an outcome that must be a failure. */
export function failureOf(outcome: ExecutionOutcome) {
  if (outcome.success) throw new Error(`expected a failure, got ${JSON.stringify(outcome.result).slice(0, 200)}`);
  return outcome.failure;
}

/** The result of an outcome that must be a success. */
export function resultOf<T = { id: string; route: string; record: Row }>(outcome: ExecutionOutcome): T {
  if (!outcome.success) throw new Error(`expected a success, got ${JSON.stringify(outcome.failure)} ${outcome.debug ?? ""}`);
  return outcome.result as T;
}

const without = (params: Row, key: string): Row => Object.fromEntries(Object.entries(params).filter(([k]) => k !== key));

export function defineCoverageSuite(cases: readonly Case[], deps: Deps): void {
  for (const c of cases) {
    const writes = c.level !== 0;
    describe(`${c.fn}: what every function of the wave is held to`, () => {
      const run = (over: Partial<ExecutableTask> = {}, params: Row = c.valid) => deps.execute(task(c.fn, params, over));
      /** A refused call must leave the store exactly as it found it. */
      const untouched = async (over: Partial<ExecutableTask>, params: Row) => {
        const before = snapshot(deps.store());
        const outcome = await run(over, params);
        expect(snapshot(deps.store())).toBe(before);
        expect(deps.store().unparsed).toEqual([]);
        return outcome;
      };

      // -- registry ---------------------------------------------------------------------------------------------------------
      test("the generated link policy is the wave's table (level, rank, money, required and text parameters, id parameters)", () => {
        const row = fnRow(c.fn);
        expect({ level: row.link_level, rank: row.min_role_rank, money: row.money_sensitive, kind: row.kind }).toEqual({
          level: c.level, rank: c.minRank, money: c.money, kind: writes ? "write" : "read",
        });
        // a write names its project among the required parameters (the link supplies it); a read of the registry does not
        expect(row.required_params.map((p) => p.name)).toEqual([...(writes ? ["projectId"] : []), ...c.required.map(([p]) => p)]);
        expect([...row.text_params].sort()).toEqual([...c.text].sort());
        for (const key of Object.keys(c.valid)) expect({ key, declared: row.declared_params.includes(key) }).toEqual({ key, declared: true });
        // the generator lists every declared parameter that ends in Id; a list of records (entries) is checked by the executor and is not in that list
        for (const [param] of c.foreign) if (/Id$/.test(param)) expect({ param, id: row.id_params.includes(param) }).toEqual({ param, id: true });
        expect(functionSpec(c.fn)!.writes).toBe(writes);
      });

      // -- the link ---------------------------------------------------------------------------------------------------------
      test("the valid parameters are a valid check on a manager's link, at the function's level", async () => {
        const { check } = linkHarness();
        const res = await check(TOKENS.manager, c.fn, c.valid);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ valid: true, missing: [], problems: [], level: c.level, will_execute_directly: c.level === 1 });
      });

      if (c.level === 0) {
        test("a read is not an action: /actions answers 400 and points at /functions", async () => {
          const { action } = linkHarness();
          expect((await action(TOKENS.manager, c.fn, c.valid)).status).toBe(400);
        });
      } else if (c.level === 1) {
        test("level 1: the direct path takes valid parameters (503, changes not switched on: not 403, not 422) and refuses missing ones with 422 and `missing`", async () => {
          const { action } = linkHarness();
          const ok = await action(TOKENS.manager, c.fn, c.valid);
          expect(ok.status).toBe(503);
          const [param] = c.required[0];
          const bad = await action(TOKENS.manager, c.fn, without(c.valid, param));
          expect(bad.status).toBe(422);
          expect(bad.body.code).toBe("PARAMS_INVALID");
          expect(bad.body.missing).toEqual([param]);
        });
      } else {
        test("level 2: refused on the direct path (403 LEVEL_NOT_ALLOWED) and a proposal, a draft the person confirms, on /propose", async () => {
          const { action, propose } = linkHarness();
          const direct = await action(TOKENS.manager, c.fn, c.valid);
          expect(direct.status).toBe(403);
          expect(direct.body.code).toBe("LEVEL_NOT_ALLOWED");
          const draft = await propose(TOKENS.manager, c.fn, Object.fromEntries(Object.entries(c.valid).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
          expect(draft.status).toBe(200);
          expect(draft.body.proposal).toMatchObject({ v: 1, function: c.fn });
          expect(draft.body.check).toMatchObject({ level: 2, will_execute_directly: false });
          expect(String(draft.body.note)).toContain("Nothing has changed");
        });
      }

      test("a missing required parameter is named in `missing` on a check, one parameter at a time", async () => {
        const { check } = linkHarness();
        for (const [param] of c.required) {
          const res = await check(TOKENS.manager, c.fn, without(c.valid, param));
          expect({ param, valid: res.body.valid, missing: res.body.missing }).toEqual({ param, valid: false, missing: [param] });
        }
      });

      test(`the minimum rank is ${c.minRank}: a viewer's link does not carry it${c.minRank === 3 ? ", nor does a member's" : ", a member's does"}`, async () => {
        const { check } = linkHarness();
        const viewer = await check(TOKENS.viewer, c.fn, c.valid);
        expect(viewer.status).toBe(403);
        expect(viewer.body.code).toBe("FUNCTION_NOT_ON_LINK");
        const member = await check(TOKENS.member, c.fn, c.valid);
        if (c.minRank === 3) {
          expect(member.status).toBe(403);
          expect(member.body.code).toBe("FUNCTION_NOT_ON_LINK");
        } else {
          expect(member.status).toBe(200);
          expect(member.body.valid).toBe(true);
        }
      });

      test("the link is for one project: another project's id in projectId is 403 WRONG_PROJECT", async () => {
        const { check } = linkHarness();
        const res = await check(TOKENS.manager, c.fn, { ...c.valid, projectId: PROJECT_B });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("WRONG_PROJECT");
      });

      // -- the free text rule -----------------------------------------------------------------------------------------------
      for (const text of c.text) {
        test(`free text "${text}": 2,000 characters pass, 2,001 are TEXT_TOO_LONG, control characters and backtick runs are removed`, async () => {
          const card = (functionSpec(c.fn)!.card?.fields ?? []).filter((f) => f.type === "text").map((f) => f.key);
          const fits = applyLinkTextRules({ [text]: "a".repeat(AI_LINK_TEXT_MAX) }, card);
          expect(fits.ok).toBe(true);
          const tooLong = applyLinkTextRules({ [text]: "a".repeat(AI_LINK_TEXT_MAX + 1) }, card);
          expect(tooLong).toMatchObject({ ok: false, code: "TEXT_TOO_LONG", field: text });
          const cleaned = applyLinkTextRules({ [text]: "a\u0000b​c‮d```e" }, card);
          expect(cleaned).toMatchObject({ ok: true, params: { [text]: "abcd''e" } });
          // and the link's own check reports it
          const { check } = linkHarness();
          const res = await check(TOKENS.manager, c.fn, { ...c.valid, [text]: "a".repeat(AI_LINK_TEXT_MAX + 1) });
          expect(res.body.valid).toBe(false);
          expect(res.body.problems.join(" ")).toContain("TEXT_TOO_LONG");
        });
      }

      // -- the executor -----------------------------------------------------------------------------------------------------
      test("a missing required parameter is a failure that names it, and nothing is written", async () => {
        for (const [param, key] of c.required) {
          const failure = failureOf(await untouched({}, without(c.valid, param)));
          expect({ param, missing: failure.missing }).toEqual({ param, missing: [key] });
        }
      });

      test("a params.projectId that names another project is PROJECT_NOT_REACHABLE, and nothing is written", async () => {
        const failure = failureOf(await untouched({}, { ...c.valid, projectId: PROJECT_B }));
        expect(failure.code).toBe("PROJECT_NOT_REACHABLE");
      });

      test(`a role below rank ${c.minRank}, and a task with no role, is refused NOT_PERMITTED, and nothing is written`, async () => {
        const roles: Array<string | null | undefined> = ["viewer", "client_viewer", "not_a_role", null, undefined];
        if (c.minRank === 3) roles.push("member");
        for (const role of roles) {
          const failure = failureOf(await untouched({ role }, c.valid));
          expect({ role, code: failure.code }).toEqual({ role, code: "NOT_PERMITTED" });
        }
      });

      if (writes) {
        test("a write that names no person is refused NOT_PERMITTED before anything is read or written", async () => {
          for (const actorUserId of [null, undefined, ""]) {
            const failure = failureOf(await untouched({ actorUserId }, c.valid));
            expect({ actorUserId, code: failure.code }).toEqual({ actorUserId, code: "NOT_PERMITTED" });
          }
        });
      }

      for (const [param, foreign, absent = "no_such_record"] of c.foreign) {
        test(`id "${param}": a record of another project, of another organisation or of no record reads as absent, and nothing is written`, async () => {
          for (const value of [foreign, absent]) {
            const failure = failureOf(await untouched({}, { ...c.valid, [param]: value }));
            expect({ param, value, code: failure.code }).toEqual({ param, value, code: "RECORD_NOT_FOUND" });
          }
        });
      }

      if (!writes) {
        test("a read on the link's own path (executeRead): a missing required parameter is 422 with `missing`; the project is forced", async () => {
          for (const [param, key] of c.required) {
            const res = await executeRead({ orgId: ORG, userId: MANAGER, projectId: PROJECT_A, functionId: c.fn, params: without(c.valid, param), role: "manager", actorUserId: MANAGER }, deps.execute);
            expect(res).toMatchObject({ ok: false, status: 422 });
            expect((res as { failure: { missing: string[] } }).failure.missing).toEqual([key]);
          }
        });
      }
    });
  }
}
