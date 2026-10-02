// lf-b5-ai-crud (owner order 2026-10-02, requirement R7; B2 left it as "needs an owner decision", the owner delegated it) -- THE
// ORGANISATION-SCOPED FUNCTION CLASS: the person's AI changes an ORGANISATION master (a record with no project) through the same service the
// app's own route calls, and nothing else.
//
// THE DESIGN (written into ai-os/AI_CRUD_COVERAGE.md for the owner to veto):
//   - THE LINK. An organisation function rides a link exactly like a project function: a project link, or a user link bound to a project
//     (drizzle/0668 ai_work_link__require_in). The link's project names nothing about the record; it is the proof that the link is bound to
//     a project of THIS organisation, and the executor re-reads it (projectExists) before anything else. So a user link outside a project
//     still offers nothing but create_project (0668's ai_work_link__fns is unchanged), and no new link kind, no new SQL path and no new
//     Edge route were needed. The organisation is the link's own (task.orgId); it is never taken from a parameter.
//   - THE ROLE. The link offers a function only to a person whose ORGANISATION role (ai_work_link__role_rank, read now) reaches the
//     function's minimum rank (ai_work_link__fns). The ranks: the rank of the app route of the same action, raised to the manager's where the
//     change reaches every project of the organisation (a category rename or retire) or is money the organisation runs on (a currency, an
//     exchange rate). Never lower than the route.
//   - THE ID RULE. Every id is looked up IN THE ORGANISATION (orgRecord below): an id of another organisation, or of no record, is
//     RECORD_NOT_FOUND and nothing is written. The services also find by id and organisation; this is the check that names the parameter.
//   - THE LEVEL. Every organisation function is level 2 (a draft the person confirms; direct only with the person's own "act without
//     asking" switch, drizzle/0685), except create_boq_category (a new pick-list value, level 1 like its route's other creates). Every
//     delete, rename and anything that writes money is level 2 without exception.
//   - THE BLAST RADIUS. rename_boq_category rewrites the category text of EVERY BOQ line of the organisation that carries the old name, on
//     every project. The draft preview the person confirms on says how many lines and projects (public.ai_work_link_draft_impact, 0687;
//     supabase/functions/ai-work-link/drafts.ts), and the answer of the change says how many were rewritten (the service's lineItemsUpdated).
//     delete_boq_category is refused by the service while any line uses the category ("Used by 12 BOQ lines"): it never cascades.
//   - WHAT IS OFFERED: only what the app's own routes and services already offer. No rule is invented:
//       create_boq_category, rename_boq_category, delete_boq_category    construction-boq-category-service.ts (delete RETIRES, never removes)
//       create_vendor, update_vendor                                     erp-buying-service.ts createSupplier/updateSupplier (isActive false retires)
//       create_customer, update_customer                                 erp-selling-service.ts createCustomer/updateCustomer (isActive false retires)
//       create_company                                                   erp-company-service.ts createCompany (the PROJEXA route has no update)
//       create_currency, create_exchange_rate                            erp-accounting-service.ts (never the base currency: an admin's act)
//     There is no delete of a vendor, a customer or a company in the app (they carry invoices and orders): retire with isActive false.
// Tests: src/lib/pipeline/coverage-crud-b5.test.ts.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { constructionBoqCategories, erpCompanies, erpCurrencies, erpCustomers, erpSuppliers } from "@/lib/db/schema";
import { createBoqCategory, deleteBoqCategory, renameBoqCategory } from "@/lib/services/construction-boq-category-service";
import { createSupplier, updateSupplier } from "@/lib/services/erp-buying-service";
import { createCustomer, updateCustomer } from "@/lib/services/erp-selling-service";
import { createCompany } from "@/lib/services/erp-company-service";
import { createCurrency, createExchangeRate } from "@/lib/services/erp-accounting-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needDate, needText, notFound, optDate, projectExists, withholdFields, type Scope } from "./record-scope";
import { given, loadActor, needClean, optClean, optId, optRange, optWhole } from "./wave79-scope";

export type OrgRecord = "boq_category" | "vendor" | "customer" | "company" | "currency";

/** True when the record exists in the task's organisation (an organisation master has no project). */
export async function orgRecord(task: ExecutableTask, kind: OrgRecord, id: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    switch (kind) {
      case "boq_category":
        return (await db.query.constructionBoqCategories.findFirst({ where: and(eq(constructionBoqCategories.id, id), eq(constructionBoqCategories.orgId, task.orgId)), columns: { id: true } })) !== undefined;
      case "vendor":
        return (await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, id), eq(erpSuppliers.orgId, task.orgId)), columns: { id: true } })) !== undefined;
      case "customer":
        return (await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, id), eq(erpCustomers.orgId, task.orgId)), columns: { id: true } })) !== undefined;
      case "company":
        return (await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, id), eq(erpCompanies.orgId, task.orgId)), columns: { id: true } })) !== undefined;
      case "currency":
        return (await db.query.erpCurrencies.findFirst({ where: and(eq(erpCurrencies.id, id), eq(erpCurrencies.orgId, task.orgId)), columns: { id: true } })) !== undefined;
    }
  });
}

/**
 * The run order of every organisation function: record-scope.ts guarded() (required parameters, the link's project, the acting person,
 * the rank), then the link's project must be a project of this organisation, then `run`.
 */
function orgGuarded(task: ExecutableTask, minRank: number, run: (scope: Scope) => Promise<ExecutionOutcome>): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank }, async (scope) => {
    if (!(await projectExists(task, scope.projectId))) return notFound(task, "projectId");
    return run(scope);
  });
}

function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

function optBool(task: ExecutableTask, key: string): boolean | undefined | typeof BAD {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return BAD;
}

// -- BOQ categories ---------------------------------------------------------------------------------------------------------------------

export async function executeCreateBoqCategory(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MEMBER, async () => {
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    // a retired category of the same name is reactivated; an active one is 409 (the service)
    const row = await createBoqCategory({ orgId: task.orgId }, name);
    return created(row.id, "/settings/boq-categories", row);
  });
}

export async function executeRenameBoqCategory(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MANAGER, async () => {
    const categoryId = needText(task, "categoryId");
    if (categoryId === BAD) return bad(task, "categoryId");
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    if (!(await orgRecord(task, "boq_category", categoryId))) return notFound(task, "categoryId");
    // rewrites every BOQ line of the organisation carrying the old name, in the same transaction; the count comes back
    const result = await renameBoqCategory({ orgId: task.orgId }, categoryId, name);
    return created(result.category.id, "/settings/boq-categories", { ...result.category, lineItemsUpdated: result.lineItemsUpdated });
  });
}

export async function executeDeleteBoqCategory(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MANAGER, async () => {
    const categoryId = needText(task, "categoryId");
    if (categoryId === BAD) return bad(task, "categoryId");
    if (!(await orgRecord(task, "boq_category", categoryId))) return notFound(task, "categoryId");
    // retired (is_active false), never removed; refused while any line uses it (409, "Used by N BOQ lines")
    const row = await deleteBoqCategory({ orgId: task.orgId }, categoryId);
    return created(row.id, "/settings/boq-categories", row);
  });
}

// -- vendors and customers --------------------------------------------------------------------------------------------------------------

type PartyFields = { gst?: string; pan?: string; type?: string; trade?: string; terms?: number; creditLimit?: number; isActive?: boolean };

/** The optional fields of a vendor or customer, in the route's own parameter names. BAD names the field that was wrong. */
function partyFields(task: ExecutableTask, keys: { gst: string; withType: boolean; withActive: boolean }): PartyFields | { bad: string } {
  const gst = patchText(task, keys.gst);
  if (gst === BAD) return { bad: keys.gst };
  const pan = patchText(task, "pan");
  if (pan === BAD) return { bad: "pan" };
  const type = keys.withType ? patchText(task, "vendorType") : undefined;
  if (type === BAD) return { bad: "vendorType" };
  const trade = keys.withType ? patchText(task, "trade") : undefined;
  if (trade === BAD) return { bad: "trade" };
  const terms = optWhole(task, "defaultPaymentTermsDays", 0, 3650);
  if (terms === BAD) return { bad: "defaultPaymentTermsDays" };
  const creditLimit = optRange(task, "creditLimit", 0, 1e12);
  if (creditLimit === BAD) return { bad: "creditLimit" };
  const isActive = keys.withActive ? optBool(task, "isActive") : undefined;
  if (isActive === BAD) return { bad: "isActive" };
  return { gst, pan, type, trade, terms, creditLimit, isActive };
}

const VENDOR_MONEY = ["creditLimit"];

export async function executeCreateVendor(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MEMBER, async () => {
    const vendorName = needClean(task, "vendorName");
    if (vendorName === BAD) return bad(task, "vendorName");
    const f = partyFields(task, { gst: "gst", withType: true, withActive: false });
    if ("bad" in f) return bad(task, f.bad);
    // the route's projectId (a vendor kept for one project) is not taken: an organisation function never writes a project id
    const row = await createSupplier({ orgId: task.orgId }, {
      supplierName: vendorName, supplierType: f.type, gstin: f.gst, panNumber: f.pan, trade: f.trade, defaultPaymentTermsDays: f.terms, creditLimit: f.creditLimit,
    });
    return created(row.id, `/vendors/${row.id}`, withholdFields(task, row, VENDOR_MONEY));
  });
}

export async function executeUpdateVendor(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MEMBER, async () => {
    const vendorId = needText(task, "vendorId");
    if (vendorId === BAD) return bad(task, "vendorId");
    const vendorName = patchText(task, "vendorName");
    if (vendorName === BAD) return bad(task, "vendorName");
    const f = partyFields(task, { gst: "gst", withType: true, withActive: true });
    if ("bad" in f) return bad(task, f.bad);
    const patch = {
      ...(vendorName ? { supplierName: vendorName } : {}),
      ...(f.type ? { supplierType: f.type } : {}),
      ...(f.gst ? { gstin: f.gst } : {}),
      ...(f.pan ? { panNumber: f.pan } : {}),
      ...(f.trade ? { trade: f.trade } : {}),
      ...(f.terms !== undefined ? { defaultPaymentTermsDays: f.terms } : {}),
      ...(f.creditLimit !== undefined ? { creditLimit: f.creditLimit } : {}),
      ...(f.isActive !== undefined ? { isActive: f.isActive } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await orgRecord(task, "vendor", vendorId))) return notFound(task, "vendorId");
    const row = await updateSupplier({ orgId: task.orgId }, vendorId, patch);
    return created(row.id, `/vendors/${row.id}`, withholdFields(task, row, VENDOR_MONEY));
  });
}

export async function executeCreateCustomer(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MEMBER, async () => {
    const customerName = needClean(task, "customerName");
    if (customerName === BAD) return bad(task, "customerName");
    const f = partyFields(task, { gst: "gstin", withType: false, withActive: false });
    if ("bad" in f) return bad(task, f.bad);
    // an active customer of the same name is 409 (the service; the database's partial unique index backs it)
    const row = await createCustomer({ orgId: task.orgId }, {
      customerName, gstin: f.gst, panNumber: f.pan, defaultPaymentTermsDays: f.terms, creditLimit: f.creditLimit,
    });
    return created(row.id, `/customers/${row.id}`, withholdFields(task, row, VENDOR_MONEY));
  });
}

export async function executeUpdateCustomer(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MEMBER, async () => {
    const customerId = needText(task, "customerId");
    if (customerId === BAD) return bad(task, "customerId");
    const customerName = patchText(task, "customerName");
    if (customerName === BAD) return bad(task, "customerName");
    const f = partyFields(task, { gst: "gstin", withType: false, withActive: true });
    if ("bad" in f) return bad(task, f.bad);
    const patch = {
      ...(customerName ? { customerName } : {}),
      ...(f.gst ? { gstin: f.gst } : {}),
      ...(f.pan ? { panNumber: f.pan } : {}),
      ...(f.terms !== undefined ? { defaultPaymentTermsDays: f.terms } : {}),
      ...(f.creditLimit !== undefined ? { creditLimit: f.creditLimit } : {}),
      ...(f.isActive !== undefined ? { isActive: f.isActive } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await orgRecord(task, "customer", customerId))) return notFound(task, "customerId");
    const row = await updateCustomer({ orgId: task.orgId }, customerId, patch);
    return created(row.id, `/customers/${row.id}`, withholdFields(task, row, VENDOR_MONEY));
  });
}

// -- companies ----------------------------------------------------------------------------------------------------------------------------

export async function executeCreateCompany(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MANAGER, async ({ actorId }) => {
    const companyName = needClean(task, "companyName");
    if (companyName === BAD) return bad(task, "companyName");
    const abbr = patchText(task, "abbr");
    if (abbr === BAD) return bad(task, "abbr");
    const country = patchText(task, "country");
    if (country === BAD) return bad(task, "country");
    const parentCompanyId = optId(task, "parentCompanyId");
    if (parentCompanyId === BAD) return bad(task, "parentCompanyId");
    const isGroup = optBool(task, "isGroup");
    if (isGroup === BAD) return bad(task, "isGroup");
    const dateOfIncorporation = optDate(task, "dateOfIncorporation");
    if (dateOfIncorporation === BAD) return bad(task, "dateOfIncorporation");
    if (parentCompanyId && !(await orgRecord(task, "company", parentCompanyId))) return notFound(task, "parentCompanyId");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    // the default currency is not taken: a currency id is not checked by the service, and the base currency is an admin's act
    const row = await createCompany({ orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor }, {
      companyName, abbr, country, parentCompanyId, isGroup, dateOfIncorporation,
    });
    return created(row.id, "/settings/companies", row);
  });
}

// -- currencies and exchange rates (money: manager rank, level 2) -------------------------------------------------------------------------

export async function executeCreateCurrency(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MANAGER, async ({ actorId }) => {
    const code = needText(task, "code");
    if (code === BAD || !/^[A-Za-z]{3}$/.test(code)) return bad(task, "code");
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    const symbol = patchText(task, "symbol");
    if (symbol === BAD) return bad(task, "symbol");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    // isBaseCurrency is never passed: making a currency the base re-denominates every figure, and the app keeps that to an admin
    const row = await createCurrency({ orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor }, { code: code.toUpperCase(), name, symbol });
    return created(row.id, "/settings/currencies", row);
  });
}

export async function executeCreateExchangeRate(task: ExecutableTask): Promise<ExecutionOutcome> {
  return orgGuarded(task, RANK_MANAGER, async ({ actorId }) => {
    const fromCurrencyId = needText(task, "fromCurrencyId");
    if (fromCurrencyId === BAD) return bad(task, "fromCurrencyId");
    const toCurrencyId = needText(task, "toCurrencyId");
    if (toCurrencyId === BAD) return bad(task, "toCurrencyId");
    if (fromCurrencyId === toCurrencyId) return bad(task, "toCurrencyId");
    const rate = optRange(task, "rate", 1e-9, 1e9);
    if (rate === BAD || rate === undefined) return bad(task, "rate");
    const rateDate = needDate(task, "rateDate");
    if (rateDate === BAD) return bad(task, "rateDate");
    // createExchangeRate does not check that the two currencies are this organisation's: this does
    if (!(await orgRecord(task, "currency", fromCurrencyId))) return notFound(task, "fromCurrencyId");
    if (!(await orgRecord(task, "currency", toCurrencyId))) return notFound(task, "toCurrencyId");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    const row = await createExchangeRate({ orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor }, { fromCurrencyId, toCurrencyId, rate, rateDate });
    return created(row.id, "/settings/currencies", row);
  });
}
