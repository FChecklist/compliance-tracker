/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-03, register row AW-201: create_project makes a shell project attributed to the person, and update_project renames
// and fills it. Both are registered pipeline writes with executors (src/lib/pipeline/executors/project.ts) and update_project is on a link
// for its own project only; create_project is on no link.
//
// PROVEN HERE
//   - registry and link policy: both are writes with executors; create_project needs no project, update_project needs one; the generated
//     link registry has update_project at level 2 (a draft), rank 2, and create_project excluded with a reason;
//   - create_project with `shell: true` and no name writes ONE project named SHELL_PROJECT_NAME, in status 'planning', in the task's org,
//     under the org's only active product, led by the acting PERSON (never the org API key's id), and isAiSetupShell() says so;
//   - a task that names no person, a role below member and an absent role are refused with nothing written; no name and no shell is
//     TITLE_REQUIRED; zero or several active products is VALUE_REQUIRED (the caller must pick); another org's product is absent;
//   - update_project renames the shell (which ends it as a shell), sets description, dates, client, project value, VAT and retention, and
//     the changes are read back from the stored row, not from the answer;
//   - update_project refuses an empty patch, a wrong type, a target date before the start date, a project of another org (absent), a
//     params.projectId that is not the task's project, and a client of another org; every refusal writes nothing;
//   - below the manager rank the answer carries the money fields as null, the stored row still changes;
//   - an empty shell raises no exception at all (the exceptions detectors are anti-joins over real rows).
//
// WHAT IS REAL: executor.ts, executors/project.ts, function-registry.ts, createProject() and updateProjectDetails(). WHAT IS FAKED: only
// @/lib/db/tenant-scoped, by __test-helpers__/boq-store-double.ts, which evaluates the real compiled where clauses against fixture rows.
//
// Run: bun test --isolate src/lib/pipeline/executor-project.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { isAiSetupShell, SHELL_PROJECT_NAME, SHELL_PROJECT_STATUS } from "@/lib/project-shell";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PERSON = "person_1";
const API_KEY = "apikey_1";
const PRODUCT = "product_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "products", [
    { id: PRODUCT, orgId: ORG, name: "Villa projects", isActive: true },
    { id: "product_x", orgId: OTHER_ORG, name: "Elsewhere", isActive: true },
  ]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  seedRows(s, "clients", [
    { id: "client_1", orgId: ORG, name: "Acme Interiors", isActive: true },
    { id: "client_x", orgId: OTHER_ORG, name: "Not ours", isActive: true },
  ]);
  seedRows(s, "projects", [
    { id: "project_other", orgId: OTHER_ORG, productId: "product_x", name: "Elsewhere tower", status: "active" },
    { id: "project_b", orgId: ORG, productId: PRODUCT, name: "Oakwood", status: "active" },
  ]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let hasExecutor: typeof import("./executor").hasExecutor;
let functionWrites: typeof import("./executor").functionWrites;
let functionSpec: typeof import("./function-registry").functionSpec;
let requiredParamSatisfied: typeof import("./function-registry").requiredParamSatisfied;
beforeAll(async () => {
  ({ executeTask, hasExecutor, functionWrites } = await import("./executor"));
  ({ functionSpec, requiredParamSatisfied } = await import("./function-registry"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

type Task = import("./executor").ExecutableTask;
const create = (params: Row, overrides: Partial<Task> = {}): Task => ({
  orgId: ORG, userId: API_KEY, projectId: null, functionId: "create_project", params, actorUserId: PERSON, role: "manager", ...overrides,
});
const update = (params: Row, overrides: Partial<Task> = {}): Task => ({
  orgId: ORG, userId: API_KEY, projectId: "project_b", functionId: "update_project", params, actorUserId: PERSON, role: "manager", ...overrides,
});

const projects = () => rowsOf(store, "projects");
const project = (id: string) => projects().find((p) => p.id === id)!;
const snapshot = () => JSON.stringify(store.tables);
const codeOf = (o: Awaited<ReturnType<typeof executeTask>>) => (o.success ? "OK" : o.failure.code);
const recordOf = (o: Awaited<ReturnType<typeof executeTask>>) => {
  if (!o.success) throw new Error(`expected success, got ${JSON.stringify(o.failure)}`);
  return (o.result as { id: string; record: Row }).record;
};

describe("AW-201: registry and link policy", () => {
  test("both are registered writes with executors; create_project needs no project, update_project needs one", () => {
    for (const id of ["create_project", "update_project"]) {
      expect({ id, executor: hasExecutor(id), write: functionWrites(id) }).toEqual({ id, executor: true, write: true });
    }
    expect(functionSpec("create_project")!.requiresProject).toBe(false);
    // it needs a name, or shell: true (the placeholder name): either answers the one required parameter
    const required = functionSpec("create_project")!.requiredParams;
    expect(required.map((p) => [p.name, p.alsoSatisfiedBy])).toEqual([["name", ["shell"]]]);
    expect(requiredParamSatisfied(required[0], { name: "Zoomies" })).toBe(true);
    expect(requiredParamSatisfied(required[0], { shell: true })).toBe(true);
    expect(requiredParamSatisfied(required[0], {})).toBe(false);
    expect(requiredParamSatisfied(required[0], { name: "  " })).toBe(false);
    expect(functionSpec("update_project")!.requiresProject).toBe(true);
    expect(functionSpec("update_project")!.requiredParams.map((p) => p.name)).toEqual(["projectId"]);
  });

  test("on the link: update_project is a level-2 draft at rank 2 for the link's own project; create_project is on no link", () => {
    const registry = JSON.parse(readFileSync(new URL("../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as Array<{
      function_id: string; link_level: number | null; min_role_rank: number; declared_params: string[]; excluded_reason: string | null
    }>;
    const upd = registry.find((f) => f.function_id === "update_project")!;
    expect({ level: upd.link_level, rank: upd.min_role_rank }).toEqual({ level: 2, rank: 2 });
    expect(upd.declared_params).toEqual(expect.arrayContaining(["name", "description", "startDate", "targetDate", "projectValue", "vatRatePercent", "retentionPercent", "clientId"]));
    const cre = registry.find((f) => f.function_id === "create_project")!;
    expect(cre.link_level).toBeNull();
    expect((cre.excluded_reason ?? "").length).toBeGreaterThan(20);
  });
});

describe("AW-201: create_project makes a shell attributed to the person", () => {
  test("*** THE ROW: shell true and no name writes ONE project named as a shell, planning, under the only active product, led by the person ***", async () => {
    const before = projects().length;
    const outcome = await executeTask(create({ shell: true }));

    expect(codeOf(outcome)).toBe("OK");
    expect(projects().length).toBe(before + 1);
    const stored = project((outcome as { result: { id: string } }).result.id);
    expect(stored).toMatchObject({ orgId: ORG, productId: PRODUCT, name: SHELL_PROJECT_NAME, status: SHELL_PROJECT_STATUS, leadUserId: PERSON });
    expect(stored.leadUserId).not.toBe(API_KEY);
    expect(isAiSetupShell(stored as { name: string; status: string })).toBe(true);
    expect(store.unparsed).toEqual([]);
  });

  test("a named project is not a shell: it keeps the default status and its own name, dates and description", async () => {
    const outcome = await executeTask(create({ name: "  Zoomies Dubai  ", description: "Play and vet areas", startDate: "2026-10-01", targetDate: "2026-12-15" }));
    expect(codeOf(outcome)).toBe("OK");
    const stored = project((outcome as { result: { id: string } }).result.id);
    expect(stored).toMatchObject({ name: "Zoomies Dubai", description: "Play and vet areas", startDate: "2026-10-01", targetDate: "2026-12-15", status: "active", leadUserId: PERSON });
    expect(isAiSetupShell(stored as { name: string; status: string })).toBe(false);
  });

  test("a shell with a name of its own is still 'planning' but no longer the shell name, so it is not a shell", async () => {
    const outcome = await executeTask(create({ shell: true, name: "Zoomies" }));
    const stored = project((outcome as { result: { id: string } }).result.id);
    expect(stored).toMatchObject({ name: "Zoomies", status: "planning" });
    expect(isAiSetupShell(stored as { name: string; status: string })).toBe(false);
  });

  test("a task that names no person is refused before anything is read or written", async () => {
    const before = snapshot();
    expect(codeOf(await executeTask(create({ shell: true }, { actorUserId: null })))).toBe("NOT_PERMITTED");
    expect(codeOf(await executeTask(create({ shell: true }, { actorUserId: undefined })))).toBe("NOT_PERMITTED");
    expect(snapshot()).toBe(before);
  });

  test("a role below member, and an absent role, are refused with nothing written; member and above are allowed", async () => {
    const before = snapshot();
    for (const role of ["viewer", "client_viewer", undefined, null, "nonsense"]) {
      const outcome = await executeTask(create({ shell: true }, { role }));
      expect({ role, code: codeOf(outcome) }).toEqual({ role, code: "NOT_PERMITTED" });
    }
    expect(snapshot()).toBe(before);
    for (const role of ["member", "manager", "admin"]) {
      expect({ role, code: codeOf(await executeTask(create({ shell: true }, { role }))) }).toEqual({ role, code: "OK" });
    }
  });

  test("no name and no shell is TITLE_REQUIRED; an empty name is the same", async () => {
    const before = snapshot();
    for (const params of [{}, { name: "   " }, { shell: false }, { description: "only a description" }]) {
      expect({ params, code: codeOf(await executeTask(create(params))) }).toEqual({ params, code: "TITLE_REQUIRED" });
    }
    expect(snapshot()).toBe(before);
  });

  test("the product: an explicit productId of the org is used; another org's is absent; none or several active products is VALUE_REQUIRED", async () => {
    seedRows(store, "products", [{ id: "product_2", orgId: ORG, name: "Commercial", isActive: true }]);
    const before = snapshot();
    // two active products and no productId: the caller must pick
    const ambiguous = await executeTask(create({ shell: true }));
    expect(codeOf(ambiguous)).toBe("VALUE_REQUIRED");
    expect(!ambiguous.success && ambiguous.failure.context).toMatchObject({ param: "productId", options: 2 });
    expect(snapshot()).toBe(before);

    const picked = await executeTask(create({ shell: true, productId: "product_2" }));
    expect(project((picked as { result: { id: string } }).result.id).productId).toBe("product_2");

    const foreign = await executeTask(create({ shell: true, productId: "product_x" }));
    expect(codeOf(foreign)).toBe("RECORD_NOT_FOUND");
    expect(projects().filter((p) => p.productId === "product_x" && p.orgId === ORG)).toEqual([]);

    // an inactive product is not a default candidate
    store.tables.products = store.tables.products.map((p) => (p.id === "product_2" ? { ...p, isActive: false } : p));
    expect(codeOf(await executeTask(create({ shell: true })))).toBe("OK");
    // and with none active at all
    store.tables.products = store.tables.products.map((p) => ({ ...p, isActive: false }));
    expect(codeOf(await executeTask(create({ shell: true })))).toBe("VALUE_REQUIRED");
  });

  test("a clientId of the org is stored; one of another org, or that does not exist, is absent and nothing is written", async () => {
    const ok = await executeTask(create({ shell: true, clientId: "client_1" }));
    expect(project((ok as { result: { id: string } }).result.id).clientId).toBe("client_1");
    const before = snapshot();
    for (const clientId of ["client_x", "no-such-client"]) {
      expect({ clientId, code: codeOf(await executeTask(create({ shell: true, clientId }))) }).toEqual({ clientId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot()).toBe(before);
  });

  test("the answer below the manager rank carries the project's money fields as null", async () => {
    const manager = recordOf(await executeTask(create({ shell: true }, { role: "manager" })));
    expect(manager.vatRatePercent).toBe("5");
    const member = recordOf(await executeTask(create({ shell: true }, { role: "member" })));
    expect([member.projectValue, member.vatRatePercent, member.retentionPercent, member.financialsRedacted]).toEqual([null, null, null, true]);
  });
});

describe("AW-201: update_project renames and fills the project", () => {
  async function shell(): Promise<string> {
    const out = await executeTask(create({ shell: true }));
    return (out as { result: { id: string } }).result.id;
  }

  test("*** THE ROW: renaming the shell ends it as a shell, and every field is read back from the stored row ***", async () => {
    const id = await shell();
    const outcome = await executeTask(
      update(
        { name: "Zoomies Dubai", description: "Indoor play and vet clinic", startDate: "2026-10-01", targetDate: "2026-12-15", clientId: "client_1", projectValue: 1596280, vatRatePercent: 5, retentionPercent: 10 },
        { projectId: id }
      )
    );
    expect(codeOf(outcome)).toBe("OK");
    const stored = project(id);
    expect(stored).toMatchObject({
      name: "Zoomies Dubai", description: "Indoor play and vet clinic", startDate: "2026-10-01", targetDate: "2026-12-15", clientId: "client_1",
      projectValue: "1596280", vatRatePercent: "5", retentionPercent: "10", status: "planning", orgId: ORG,
    });
    expect(isAiSetupShell(stored as { name: string; status: string })).toBe(false);
    // the other project of the org is untouched
    expect(project("project_b").name).toBe("Oakwood");
  });

  test("only the fields sent change; null clears a clearable field", async () => {
    const id = await shell();
    await executeTask(update({ description: "first", clientId: "client_1", projectValue: 100 }, { projectId: id }));
    await executeTask(update({ name: "Only the name" }, { projectId: id }));
    expect(project(id)).toMatchObject({ name: "Only the name", description: "first", clientId: "client_1", projectValue: "100" });
    await executeTask(update({ description: null, clientId: null, projectValue: null }, { projectId: id }));
    expect(project(id)).toMatchObject({ name: "Only the name", description: null, clientId: null, projectValue: null });
  });

  test("an empty patch, a wrong type, a bad date, a target before the start and an out-of-range percent are refused with nothing written", async () => {
    const before = snapshot();
    const bad: Row[] = [
      {}, { unknownField: "x" }, { name: 5 }, { name: "   " }, { description: 7 }, { startDate: "01/10/2026" }, { startDate: "2026-02-31" },
      { projectValue: "lots" }, { projectValue: -1 }, { vatRatePercent: 101 }, { retentionPercent: -5 }, { retentionPercent: null },
      { startDate: "2026-10-01", targetDate: "2026-09-01" },
    ];
    for (const params of bad) {
      const outcome = await executeTask(update(params));
      expect({ params, code: codeOf(outcome) }).toEqual({ params, code: "REQUEST_REJECTED" });
    }
    expect(snapshot()).toBe(before);
  });

  test("a target date before the stored start date is refused too (the merged dates are checked, not only the ones sent)", async () => {
    const id = await shell();
    await executeTask(update({ startDate: "2026-10-01" }, { projectId: id }));
    const before = snapshot();
    expect(codeOf(await executeTask(update({ targetDate: "2026-09-01" }, { projectId: id })))).toBe("REQUEST_REJECTED");
    expect(snapshot()).toBe(before);
  });

  test("a project of another org is absent; a params.projectId that is not the task's project is PROJECT_NOT_REACHABLE; a client of another org is absent", async () => {
    const before = snapshot();
    expect(codeOf(await executeTask(update({ name: "Hijack" }, { projectId: "project_other" })))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await executeTask(update({ name: "Hijack", projectId: "project_other" })))).toBe("PROJECT_NOT_REACHABLE");
    expect(codeOf(await executeTask(update({ clientId: "client_x" })))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await executeTask(update({ name: "x" }, { projectId: null })))).toBe("PROJECT_REQUIRED");
    expect(snapshot()).toBe(before);
    expect(project("project_other").name).toBe("Elsewhere tower");
  });

  test("no person, and a role below member, are refused with nothing written", async () => {
    const before = snapshot();
    expect(codeOf(await executeTask(update({ name: "x" }, { actorUserId: null })))).toBe("NOT_PERMITTED");
    expect(codeOf(await executeTask(update({ name: "x" }, { role: "viewer" })))).toBe("NOT_PERMITTED");
    expect(codeOf(await executeTask(update({ name: "x" }, { role: undefined })))).toBe("NOT_PERMITTED");
    expect(snapshot()).toBe(before);
  });

  test("below the manager rank the answer shows the money fields as null, and the stored row still changes", async () => {
    const asMember = recordOf(await executeTask(update({ projectValue: 500, vatRatePercent: 7, retentionPercent: 3 }, { role: "member" })));
    expect([asMember.projectValue, asMember.vatRatePercent, asMember.retentionPercent, asMember.financialsRedacted]).toEqual([null, null, null, true]);
    expect(project("project_b")).toMatchObject({ projectValue: "500", vatRatePercent: "7", retentionPercent: "3" });
    const asManager = recordOf(await executeTask(update({ projectValue: 600 }, { role: "manager" })));
    expect(asManager.projectValue).toBe("600");
    expect(asManager.financialsRedacted).toBeUndefined();
  });
});

describe("AW-201: an empty shell raises no exception", () => {
  test("getProjectExceptions over a fresh shell flags none of its 28 checks", async () => {
    const out = await executeTask(create({ shell: true }));
    const id = (out as { result: { id: string } }).result.id;
    const { getProjectExceptions } = await import("@/lib/services/construction-exceptions-service");
    const checks = await getProjectExceptions({ orgId: ORG }, id);
    expect(checks.length).toBeGreaterThanOrEqual(28);
    expect(checks.filter((c) => c.flagged)).toEqual([]);
    // Not asserted: store.unparsed. The double does not read `<>`, `>=` or `<` comparisons, so a few detectors' where clauses match nothing
    // by construction; on a project with no rows that is also the right answer, which is all this test claims (it says nothing about a
    // project that has data).
  });
});
