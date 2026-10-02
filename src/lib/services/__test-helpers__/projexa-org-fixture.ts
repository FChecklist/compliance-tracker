// PROJEXA SYNC: the organisation-master fixture shared by projexa-sync-org-masters.pglite.test.ts (the SQL functions) and projexa-sync-org-routes.pglite.test.ts (the Edge routes).
// The master tables as schema.ts declares them (the PGlite base snapshot does not carry them), their rows with decoys of another organisation, and the PGlite database built
// the way the live one is (0618 gateway, the AI work link, 0677 to 0683, then the master tables BEFORE 0684 so its triggers attach, then 0684, then the rows).
import type { PGlite } from "@electric-sql/pglite"
import { forwardSql } from "./awl-pglite"
import { createUserLinkDb } from "./awl-user-link-db"
import { insert } from "./awl-records-v2-db"

export const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-adm": "33333333-3333-4333-8333-333333333333",
  "u-b": "44444444-4444-4444-8444-444444444444",
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-cv": "77777777-7777-4777-8777-777777777777",
}
export const ORG_KINDS = ["vendors", "customers", "companies", "boq_categories", "currencies", "exchange_rates", "departments", "org_people", "cost_visibility"] as const
export const RANK2 = ORG_KINDS.filter((k) => k !== "cost_visibility")

/** The master tables as schema.ts declares them (the PGlite base snapshot does not carry them), each with two extra columns a real table could
 *  have and that must NEVER leave: a bank account and a SECRET internal note. Created BEFORE 0684 so its triggers attach, exactly as live. */
export const MASTER_TABLES = `
create table if not exists compliance.erp_suppliers (id text primary key, org_id text not null, supplier_name text not null, supplier_type text, gstin text, pan_number text,
  default_payment_terms_days integer, vendor_risk_profile_id text, tax_withholding_category_id text, is_active boolean not null default true, created_at timestamp not null default now(),
  qualification_status text not null default 'not_started', sanction_screening_status text not null default 'not_checked', sanction_screened_at timestamp, credit_limit numeric, trade text, project_id text);
create table if not exists compliance.erp_customers (id text primary key, org_id text not null, customer_name text not null, client_id text, gstin text, pan_number text,
  default_payment_terms_days integer, credit_limit numeric, is_active boolean not null default true, created_at timestamp not null default now());
create table if not exists compliance.erp_companies (id text primary key, org_id text not null, company_name text not null, abbr text, parent_company_id text, is_group boolean not null default false,
  default_currency_id text, country text, date_of_incorporation date, is_active boolean not null default true, created_at timestamp not null default now());
create table if not exists compliance.construction_boq_categories (id text primary key, org_id text not null, name text not null, sort_order integer not null default 0,
  is_active boolean not null default true, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists compliance.erp_currencies (id text primary key, org_id text not null, code text not null, name text not null, symbol text, is_base_currency boolean not null default false,
  created_at timestamp not null default now());
create table if not exists compliance.erp_exchange_rates (id text primary key, org_id text not null, from_currency_id text not null, to_currency_id text not null, rate numeric not null,
  rate_date date not null, source text not null default 'manual', created_at timestamp not null default now());
create table if not exists compliance.departments (id text primary key, name text not null, description text, org_id text not null, head_id text unique,
  created_at timestamp not null default now(), updated_at timestamp not null default now());
alter table compliance.erp_suppliers add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.erp_customers add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.erp_companies add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.departments add column if not exists internal_notes text;
`

export const SECRET = { bank_account_number: "SECRET-ACCT-0001", internal_notes: "SECRET internal note" }
export const FIXTURE = [
  `insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
     ('u-cv', 'Cleo Client', 'cleo@a.example.test', 'SECRET-hash', 'client_viewer', true, 'org-a', '77777777-7777-4777-8777-777777777777');`,
  `update compliance.users set passcode_hash = 'SECRET-passcode' where id = 'u-mem';`,
  `insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values ('cv-b', 'org-b', 'manager', true, 'u-b');`,
  insert("erp_suppliers", [
    { id: "ven-1", org_id: "org-a", supplier_name: "Ace Cement", supplier_type: "material", gstin: "SECRET-GSTIN", pan_number: "SECRET-PAN", credit_limit: 500000, trade: "civil", default_payment_terms_days: 30, ...SECRET, sanction_screening_status: "flagged" },
    { id: "ven-2", org_id: "org-a", supplier_name: "Bright Paints", supplier_type: "material", credit_limit: 100000, ...SECRET },
    { id: "SECRET-ven-b", org_id: "org-b", supplier_name: "SECRET org b vendor", credit_limit: 1 },
  ]),
  insert("erp_customers", [
    { id: "cus-1", org_id: "org-a", customer_name: "Villa Owner", gstin: "SECRET-GSTIN", pan_number: "SECRET-PAN", credit_limit: 250000, ...SECRET },
    { id: "SECRET-cus-b", org_id: "org-b", customer_name: "SECRET org b customer" },
  ]),
  insert("erp_companies", [
    { id: "co-1", org_id: "org-a", company_name: "A Builders HO", abbr: "HO", country: "IN", ...SECRET },
    { id: "co-2", org_id: "org-a", company_name: "A Builders Site Office", abbr: "SO", parent_company_id: "co-1" },
    { id: "SECRET-co-b", org_id: "org-b", company_name: "SECRET org b company" },
  ]),
  insert("construction_boq_categories", [
    { id: "cat-1", org_id: "org-a", name: "Civil", sort_order: 1 },
    { id: "cat-2", org_id: "org-a", name: "Finishes", sort_order: 2 },
    { id: "SECRET-cat-b", org_id: "org-b", name: "SECRET" },
  ]),
  insert("erp_currencies", [
    { id: "cur-inr", org_id: "org-a", code: "INR", name: "Indian Rupee", symbol: "₹", is_base_currency: true },
    { id: "cur-aed", org_id: "org-a", code: "AED", name: "UAE Dirham" },
    { id: "SECRET-cur-b", org_id: "org-b", code: "USD", name: "SECRET" },
  ]),
  insert("erp_exchange_rates", [
    { id: "fx-1", org_id: "org-a", from_currency_id: "cur-aed", to_currency_id: "cur-inr", rate: 22.7, rate_date: "2026-10-01" },
    { id: "SECRET-fx-b", org_id: "org-b", from_currency_id: "SECRET-cur-b", to_currency_id: "SECRET-cur-b", rate: 1, rate_date: "2026-10-01" },
  ]),
  insert("departments", [
    { id: "dep-1", org_id: "org-a", name: "Site Execution", description: "Runs the sites", head_id: "u-mgr", internal_notes: SECRET.internal_notes },
    { id: "SECRET-dep-b", org_id: "org-b", name: "SECRET" },
  ]),
].join("\n")

/** What organisation A's member must receive per kind (sorted ids). */
export const OWN_A: Record<(typeof ORG_KINDS)[number], string[]> = {
  vendors: ["ven-1", "ven-2"],
  customers: ["cus-1"],
  companies: ["co-1", "co-2"],
  boq_categories: ["cat-1", "cat-2"],
  currencies: ["cur-aed", "cur-inr"],
  exchange_rates: ["fx-1"],
  departments: ["dep-1"],
  org_people: ["u-adm", "u-cv", "u-mem", "u-mgr", "u-off", "u-sen", "u-view"],
  cost_visibility: ["cv1", "cv3"],
}

export async function build(): Promise<PGlite> {
  const d = await createUserLinkDb()
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0683_projexa_sync_more_kinds"]) await d.exec(forwardSql(m))
  await d.exec(MASTER_TABLES)
  await d.exec(forwardSql("0684_projexa_sync_org_masters"))
  await d.exec(FIXTURE)
  return d
}
