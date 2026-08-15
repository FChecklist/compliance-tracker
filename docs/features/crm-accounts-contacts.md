# CRM Accounts & Contacts

Documentation & In-App Help Coverage gap-closure (VERIDIAN Review Framework,
"Accounts & Contacts"). This is the first real doc for this feature -- it
did not exist anywhere in `docs/` before this change.

## What this is

A company-level **Account** record (industry, website, billing/shipping
address, lifecycle stage, owner, and an optional parent account for
subsidiary/holding-company hierarchies) with a roster of person-level
**Contacts** underneath it (name, title, email, phone, one marked primary).

Sibling to the existing Leads/Opportunities surfaces under Sales & CRM
(`/crm`), not a replacement for them -- a Lead can convert into an Account
(`/crm` → "To Account" on a lead row) the same way it can convert into a
Client, and an Opportunity can be linked to an Account once one exists.

- List + detail UI: `/crm/accounts` and `/crm/accounts/[id]`.
- API: `src/app/api/crm/accounts/**`, `src/app/api/crm/contacts/**`.
- Service layer: `src/lib/services/crm-accounts-service.ts`.
- Data model: `crm_accounts` / `crm_contacts` in `src/lib/db/schema.ts`
  (`drizzle/0219_wave_b_crm_accounts_contacts.sql` + follow-up migrations).

## Lifecycle stages

`prospect` → `active_client` → `dormant` / `churned`. Set on create,
editable at any time by whoever can edit the account (see Access control
below).

## Access control

- Any member-rank user (or above) can **create** an account/contact, and
  can **edit** an account/contact they own (or an unowned one).
- **Reassigning ownership or deleting** an account is manager-rank or
  above, regardless of who currently owns it.
- Deleting an account is blocked while it still has contacts, child
  accounts, or linked leads/opportunities -- those must be reassigned or
  removed first (no cascading delete).

See `canEditAccount` / `canReassignOrDeleteAccount` /
`canCreateCrmRecord` in `crm-accounts-service.ts`.

## Duplicate detection

Creating or renaming an account soft-blocks (HTTP 409, not a hard
constraint) on a case/whitespace-insensitive name match or a matching
website domain against another account in the same org. The caller can
resubmit with `confirmDuplicate: true` to save anyway -- two unrelated
companies can legitimately share a name.

## AI Copilot: account health analysis

`POST /api/crm/accounts/:id/analyze` (also a button on the account detail
page) runs the same Wave 75 CRM Intelligence pattern already used for lead
scoring / opportunity win-probability, extended to accounts: an AI health
score (0-100), a list of concrete risk factors, and one recommended next
action, computed from the account's own fields plus its linked contacts
and opportunities. Results are stored on the account
(`aiHealthScore` / `aiRiskFactors` / `aiRecommendedAction` /
`aiAnalyzedAt`) and re-run on demand, same as lead/opportunity scoring.

## Reporting

`crm_accounts` and `crm_contacts` are whitelisted data sources in the
Reports & Analysis Engine's table registry
(`report-engine-service.ts#TABLE_REGISTRY`), the same mechanism
`crm_leads`/`crm_opportunities` already use -- an org can build an ad-hoc
grouped report (e.g. "accounts by lifecycle stage", "contacts per
account") from the Reports & Analysis section without any code change.

## Bulk operations

`POST /api/crm/accounts/bulk-reassign` (`{ accountIds: string[], ownerId:
string | null }`) reassigns many accounts' owner at once -- same
manager-rank gate and notification-on-reassignment as a single-account
reassignment. Mirrors the existing `v1/projexa/leads/bulk-reassign`
precedent.

## Import / export

- `GET /api/crm/accounts/export` -- downloads the org's full account book
  as CSV.
- `POST /api/crm/accounts/import` -- multipart file upload (`.csv`,
  `.xlsx`, or `.xls`); recognizes `name` (required), `industry`,
  `website`, `lifecycle stage`, `owner email` (matched against an org
  member's email), `billing city`, `billing country` headers
  case-insensitively. Row-level partial success -- one malformed or
  duplicate row is reported as an error for that row number, not a
  failure of the whole batch, so importing an org's existing account
  spreadsheet doesn't get blocked by a handful of bad rows.

## Notifications

- Adding a contact notifies the account's owner (if any, and if they
  didn't add it themselves).
- Reassigning an account (single or bulk) notifies the new owner.

Both use the existing generic `notifications` table/pattern (the same one
tasks/tickets/compliance items already use) -- no new notification
plumbing.

## Cross-module integration

`crm_accounts.erpCustomerId` / `crm_accounts.clientId` are nullable bridge
columns into the ERP selling identity (`erp_customers`) and VERIDIAN's own
compliance-client identity (`clients`) -- the same
bare-text/no-FK/nullable convention `crmOpportunities.erpCustomerId` /
`crmLeads.clientId` already established. An account is the intended
unification point across those 3 identity spaces; setting these columns is
additive and does not change existing lead/opportunity/client behavior.

## Localization

No CRM monetary field in this codebase (`crm_leads`, `crm_opportunities`
included) carries a currency column today -- amounts are stored as bare
numerics with an implicit org-default currency. `crm_accounts` currently
has no monetary/contract-value field at all, so there is nothing to make
currency-aware yet. If a contract-value field is added to accounts in the
future, it should follow whatever multi-currency convention the rest of
the CRM/ERP monetary fields adopt at that time, not invent its own.
