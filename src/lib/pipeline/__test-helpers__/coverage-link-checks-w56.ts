/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05e/05f and AW-312 -- the link-side checks the wave 5, wave 6 and exception-capture coverage tests share.
//
// Given one function's expected policy (written out again in the test that calls this, an independent copy of the data file), it
// registers the tests that hold for EVERY function on a link, through the REAL Edge handler (supabase/functions/ai-work-link/handler.ts)
// over the in-memory fake of the link's database (awl-edge-fake.ts), with writes switched on and the executor present (a level-1 change is direct only
// then, BUILD-002 WP-09a), the same configuration as coverage-fixtures.ts's linkHarness. Nothing here reads a database or a secret.
//
//   registry     the generated JSON row has the level, rank, money flag, free-text parameters and id parameters the test expects, and
//                declares every parameter the valid call uses
//   role         a link of a person below the rank never lists the function (the effective list is cut by min_role_rank) and a check of it
//                is 403 FUNCTION_NOT_ON_LINK; a link at the rank lists it
//   valid        the valid parameters are a valid check; only a level-1 write is "will_execute_directly"
//   missing      each required parameter left out is reported by name (on /check, and as 422 on /actions for a level-1 function)
//   level        a level-2 function is refused on /actions (403 LEVEL_NOT_ALLOWED) and is a valid check and a proposal (a draft the person
//                confirms); a read is refused on /actions (400)
//   project      a params.projectId naming another project is 403 WRONG_PROJECT; the link supplies the project
//   text         a free-text parameter over 2,000 characters is a problem (TEXT_TOO_LONG); an undeclared name is a problem
//
// Lives in __test-helpers__ for the reason pipeline-store-double.ts does: a test seam is not a module that owes the repo a sibling test.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { handleAwl } from "../../../../supabase/functions/ai-work-link/handler";
import { TOKENS, makeFake, req, testConfig } from "../../services/__test-helpers__/awl-edge-fake";

type Row = Record<string, unknown>;

export type RegistryRow = {
  function_id: string;
  kind: "read" | "write";
  link_level: number | null;
  min_role_rank: number;
  money_sensitive: boolean;
  excluded_reason: string | null;
  text_params: string[];
  declared_params: string[];
  required_params: Array<{ name: string; any_of: string[] }>;
  id_params: string[];
};

export const REGISTRY = JSON.parse(readFileSync(new URL("../../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as RegistryRow[];
export const registryRow = (id: string): RegistryRow | undefined => REGISTRY.find((f) => f.function_id === id);

export type LinkExpectation = {
  id: string;
  kind: "read" | "write";
  /** 0 = read, 1 = direct write, 2 = draft. */
  level: 0 | 1 | 2;
  rank: number;
  money: boolean;
  /** The free-text parameters (spec 9.11), exactly. */
  text: string[];
  /** The id parameters (declared names ending in Id, except projectId), exactly. */
  ids: string[];
  /** A parameter set the link accepts as valid. */
  valid: Row;
  /** The required parameters other than projectId, by their registry names. */
  required: string[];
};

function link() {
  const fake = makeFake({ writesEnabled: true });
  const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig({ execPresent: true }), log: () => {} });
  return { fake, run };
}

type Check = { valid: boolean; missing: string[]; problems: string[]; level: number; will_execute_directly: boolean };

/** The token whose person is exactly at `rank` (viewer 1, member 2, manager 3). */
const tokenAtRank = (rank: number): string => (rank >= 3 ? TOKENS.manager : rank === 2 ? TOKENS.member : TOKENS.viewer);

export function describeLinkContract(x: LinkExpectation): void {
  describe(`${x.id}: the link (level ${x.level}, rank ${x.rank}${x.money ? ", money" : ""})`, () => {
    const { run } = link();
    const check = (token: string, params: Row, fn = x.id) => run(`/${token}/check`, { method: "POST", body: { function: fn, params } });
    const checkOf = async (r: Response) => (await r.json()) as Check & { error?: string; code?: string };

    test("the generated registry row has the level, rank, money flag, text and id parameters written here, and declares every parameter of the valid call", () => {
      const row = registryRow(x.id);
      expect(row).toBeDefined();
      expect({ kind: row!.kind, level: row!.link_level, rank: row!.min_role_rank, money: row!.money_sensitive, excluded: row!.excluded_reason }).toEqual({
        kind: x.kind, level: x.level, rank: x.rank, money: x.money, excluded: null,
      });
      expect([...row!.text_params].sort()).toEqual([...x.text].sort());
      expect([...row!.id_params].sort()).toEqual([...x.ids].sort());
      for (const name of Object.keys(x.valid)) expect({ id: x.id, name, declared: row!.declared_params.includes(name) }).toEqual({ id: x.id, name, declared: true });
      // every text parameter is declared, or the cap would not see it
      for (const name of x.text) expect(row!.declared_params).toContain(name);
      // the required parameters (other than the project the link supplies) are the ones written here
      expect(row!.required_params.map((r) => r.name).filter((n) => n !== "projectId").sort()).toEqual([...x.required].sort());
    });

    test("role: a link below the rank does not list the function and a check of it is 403 FUNCTION_NOT_ON_LINK; a link at the rank lists it", async () => {
      const { run: go } = link();
      const listed = async (token: string) => ((await (await go(`/${token}/context`, { headers: { accept: "application/json" } })).json()) as { allowed_functions: string[] }).allowed_functions;
      // the ranks below x.rank (viewer is 1, member 2)
      for (let below = 1; below < x.rank; below++) {
        const token = tokenAtRank(below);
        expect({ id: x.id, below, listed: (await listed(token)).includes(x.id) }).toEqual({ id: x.id, below, listed: false });
        const refused = await check(token, x.valid);
        expect({ id: x.id, below, status: refused.status }).toEqual({ id: x.id, below, status: 403 });
        expect((await checkOf(refused)).code).toBe("FUNCTION_NOT_ON_LINK");
      }
      expect({ id: x.id, listed: (await listed(tokenAtRank(x.rank))).includes(x.id) }).toEqual({ id: x.id, listed: true });
    });

    test("a valid check names the level and is only 'will execute directly' for a level-1 write", async () => {
      const res = await checkOf(await check(tokenAtRank(x.rank), x.valid));
      expect(res).toMatchObject({ valid: true, missing: [], problems: [], level: x.level, will_execute_directly: x.kind === "write" && x.level === 1 });
    });

    test("each required parameter left out is reported by name", async () => {
      for (const name of x.required) {
        const params = { ...x.valid };
        delete params[name];
        const res = await checkOf(await check(tokenAtRank(x.rank), params));
        expect({ id: x.id, name, valid: res.valid, missing: res.missing }).toEqual({ id: x.id, name, valid: false, missing: [name] });
      }
    });

    if (x.kind === "write" && x.level === 1) {
      test("/actions: a level-1 write with a parameter missing is 422 PARAMS_INVALID naming it", async () => {
        const { run: go } = link();
        for (const name of x.required) {
          const params = { ...x.valid };
          delete params[name];
          const res = await go(`/${tokenAtRank(x.rank)}/actions`, { method: "POST", body: { function: x.id, params } });
          const body = (await res.json()) as { code: string; missing: string[] };
          expect({ id: x.id, name, status: res.status, code: body.code, missing: body.missing }).toEqual({ id: x.id, name, status: 422, code: "PARAMS_INVALID", missing: [name] });
        }
      });
    }

    if (x.kind === "write" && x.level === 2) {
      test("a level-2 function is refused on /actions (LEVEL_NOT_ALLOWED) and is a valid check and a proposal: a draft the person confirms", async () => {
        const { run: go } = link();
        const token = tokenAtRank(x.rank);
        const direct = await go(`/${token}/actions`, { method: "POST", body: { function: x.id, params: x.valid } });
        expect(direct.status).toBe(403);
        expect(((await direct.json()) as { code: string }).code).toBe("LEVEL_NOT_ALLOWED");
        const proposal = await go(`/${token}/propose?fn=${x.id}`, { headers: { accept: "application/json" } });
        expect(proposal.status).toBe(200);
        const body = (await proposal.json()) as { check: Check; confirm_url: string; note: string };
        expect(body.check).toMatchObject({ level: 2, will_execute_directly: false });
        expect(body.note).toContain("Nothing has changed");
        expect(body.confirm_url).toContain("/ai-inbox.html");
      });
    }

    if (x.kind === "read") {
      test("a read is refused on /actions: reads go to /functions or /records", async () => {
        const { run: go } = link();
        const res = await go(`/${tokenAtRank(x.rank)}/actions`, { method: "POST", body: { function: x.id, params: x.valid } });
        expect(res.status).toBe(400);
      });
    }

    test("a params.projectId naming another project is 403 WRONG_PROJECT: the link supplies the project", async () => {
      const res = await check(tokenAtRank(x.rank), { ...x.valid, projectId: "proj_b" });
      expect(res.status).toBe(403);
      expect((await checkOf(res)).code).toBe("WRONG_PROJECT");
    });

    test("a name the registry does not declare is a problem, and each free-text parameter over 2,000 characters is TEXT_TOO_LONG", async () => {
      const unknown = await checkOf(await check(tokenAtRank(x.rank), { ...x.valid, not_a_parameter: 1 }));
      expect(unknown.valid).toBe(false);
      expect(unknown.problems.join(" ")).toContain("Unknown parameter not_a_parameter");
      for (const name of x.text) {
        const long = await checkOf(await check(tokenAtRank(x.rank), { ...x.valid, [name]: "x".repeat(2001) }));
        expect({ id: x.id, name, valid: long.valid, problem: long.problems.join(" ").includes("TEXT_TOO_LONG") }).toEqual({ id: x.id, name, valid: false, problem: true });
        const edge = await checkOf(await check(tokenAtRank(x.rank), { ...x.valid, [name]: "x".repeat(2000) }));
        expect({ id: x.id, name, problems: edge.problems }).toEqual({ id: x.id, name, problems: [] });
      }
    });
  });
}
