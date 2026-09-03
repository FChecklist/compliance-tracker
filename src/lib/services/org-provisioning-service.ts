// PLATFORM-01 Wave 1 (Workstream 1, platform-level tenant provisioning).
// Shared org-creation body, factored out of auth-guard.ts's
// autoProvisionUser() so both provisioning paths -- the existing
// human-signup flow (which additionally creates a users row + 5
// aiAssistants for the interactive human completing signup) and the new
// service-to-service POST /api/v1/platform/provision-org flow (no
// interactive human at provisioning time, so no users/aiAssistants rows
// are created here) -- share exactly one implementation instead of two
// copies that can silently drift apart.
//
// Uses the raw (RLS-bypassing) db client deliberately -- creating a brand
// new tenant is inherently a platform-level operation that can't be scoped
// to an org that doesn't exist yet (same reasoning autoProvisionUser's own
// header comment already documented before this extraction).
import { db, organisations, departments, productBranches, orgProductBranchEnablements, erpCurrencies } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getProvisioningDb } from "@/lib/db/provisioning"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { provisionFiscalYearAndAccounts } from "./org-fiscal-year-provisioning"

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "org"
}

export type ProvisionOrganisationInput = {
  name: string
  // R51 go-to-market (R-62 "screens show AED", R-63 "org has no currency row
  // - would fall back to rupee"). These two were previously accepted and then
  // DISCARDED here, on the stated grounds that "organisations has no `country`
  // column and no currency FK yet". Both halves of that are now false, and the
  // consequences were live in production:
  //
  //   * organisations.country DOES exist and defaults to 'IN' (schema.ts:123).
  //     So dropping the caller's country did not leave it unset -- it silently
  //     stamped every new tenant as an INDIAN company. Measured 2026-08-26:
  //     the live demo tenant "Demo Organization", "Cobalt Fitout FZE" (a UAE
  //     free-zone entity) and "Meridian Interiors LLC" were all country='IN'.
  //     That is not cosmetic: country routes the compliance engine
  //     (compliance-engine-registry.ts / einvoice-format.ts), so UAE companies
  //     were being given Indian GST/TDS instead of UAE VAT.
  //   * currency has a real home in compliance.erp_currencies (org_id, code,
  //     is_base_currency). Dropping primaryCurrency left every new org with NO
  //     base-currency row, which is exactly the condition that made the UI fall
  //     back to a rupee label for every amount on every screen.
  //
  // PROJEXA already sends both (see projexa's /api/org/provision and
  // /api/org/repair) and /api/v1/platform/provision-org already parses and
  // forwards both. The values travelled the whole way here and died on this
  // line. They are now persisted.
  country?: string
  primaryCurrency?: string
  // PLATFORM-01 Wave 1: which sibling product this org primarily belongs
  // to (resolved by the caller from a platform_applications row's
  // applicationKey). null/undefined for the existing human-signup path,
  // which predates this concept and isn't tagged to one product branch.
  primaryProductBranchId?: string | null
}

export type ProvisionOrganisationResult = {
  organisationId: string
  defaultDepartmentId: string
}

// Gap-closure (VERIDIAN Review Framework, AI Cost Governance & FinOps,
// 2026-07-18): cost-guard.ts's monthlyCostCapUsd/costCapEnforcementEnabled
// mechanism was real but opt-in per org (both null/false-equivalent for
// every org until an admin visited /api/settings/org-limits and turned it
// on) -- so free/trial orgs, the exact population most exposed to abuse,
// had zero AI spend cap by default. Every org this function creates today
// is plan "free" (there is no paid-signup path yet -- see this table's own
// comment in schema.ts), so this is keyed on `plan` rather than hardcoded,
// the same way a future paid tier would just add its own branch returning
// null (unenforced) here without touching call sites. $20/mo is generous
// enough for genuine trial usage on the platform-default floor-tier model
// (see orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL / llm-client.ts's
// MODEL_PRICING for openai/gpt-oss-120b: tens of millions of tokens at that
// price) while bounding worst-case abuse of an unattended free org. Does
// NOT touch any pre-existing organisations row -- opt-in-at-creation only,
// same posture licensedSeats/monthlyCostCapUsd have always had; an existing
// free-plan org stays uncapped until an admin (or a future backfill,
// explicitly not this change) sets one.
export function defaultMonthlyCostCapUsdForPlan(plan: string): number | null {
  return plan === "free" ? 20 : null
}

// Display names for the currencies this product is actually sold in. Anything
// not listed falls back to its own ISO code as the name -- deliberately, so we
// never invent a label for a currency we were not told about.
const CURRENCY_NAMES: Record<string, string> = {
  AED: "UAE Dirham",
  INR: "Indian Rupee",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "Pound Sterling",
  SAR: "Saudi Riyal",
  QAR: "Qatari Riyal",
  OMR: "Omani Rial",
  BHD: "Bahraini Dinar",
  KWD: "Kuwaiti Dinar",
}

/**
 * Creates a brand-new organisation + its default "General" department +
 * the 2 free/on-by-default product-branch enablements every org gets
 * (VERI Reward, VERI Chat v2). Does NOT create any users/aiAssistants rows
 * -- that remains the caller's responsibility, since only the human-signup
 * path (autoProvisionUser) has an interactive human to attach those to.
 */
export async function provisionOrganisation(input: ProvisionOrganisationInput): Promise<ProvisionOrganisationResult> {
  const orgName = input.name.trim() || "New Organisation"
  const baseSlug = slugify(orgName)
  let slug = baseSlug
  let attempt = 0
  // Find a free slug (organisations.slug is unique).
  //
  // This MUST read on the elevated connection, not `db`. compliance.organisations
  // has FORCED RLS and the app_runtime policy is (id = current_org_id()), so a
  // read through `db` while outside any tenant context matches NO rows -- the
  // loop then believes every slug is free, exits immediately, and the INSERT
  // below dies on the unique constraint.
  //
  // Observed in production on 2026-08-26: provisioning for an org whose slug
  // already existed logged `slug=meridian-interiors-llc` with no `-1` suffix
  // and failed at the INSERT. Probed directly: app_runtime with no tenant
  // context returns 0 rows for that exact slug, while an elevated role returns
  // 1. A blind uniqueness check is worse than none -- it turns a handled
  // collision into an unhandled 500.
  while (await getProvisioningDb().query.organisations.findFirst({ where: eq(organisations.slug, slug) })) {
    attempt += 1
    slug = `${baseSlug}-${attempt}`
    if (attempt > 20) break // pathological collision case, give up gracefully
  }

  const plan = "free"
  // R48_ORG_PROVISION_RLS_BLOCKED_01 / R-CRR-23. THE ONE STATEMENT that runs
  // on the elevated connection. compliance.organisations has FORCED RLS whose
  // only app_runtime policy is WITH CHECK (id = current_org_id()), and a row
  // that is creating the org itself can never satisfy that -- proved by
  // running this exact INSERT under SET ROLE app_runtime and getting "new row
  // violates row-level security policy". You cannot be inside a tenant before
  // the tenant exists. Everything below this line goes back through
  // app_runtime under normal RLS, scoped to the org we just created.
  const [org] = await getProvisioningDb().insert(organisations).values({
    name: orgName,
    slug,
    plan,
    // R51: persist the caller's country instead of letting the column default
    // to 'IN'. Omitted only when the caller genuinely didn't supply one, in
    // which case the schema default still applies -- we never invent a country.
    ...(input.country?.trim() ? { country: input.country.trim().toUpperCase() } : {}),
    primaryProductBranchId: input.primaryProductBranchId ?? null,
    monthlyCostCapUsd: defaultMonthlyCostCapUsdForPlan(plan)?.toString() ?? null,
    costCapEnforcementEnabled: true,
  }).returning()

  // R51 (R-63): give the org its base currency row. Without this a brand-new
  // tenant has NO row in erp_currencies, and every money figure in the product
  // renders with whatever the UI falls back to -- precisely the R-62/R-63
  // defect. Non-fatal, matching the enablement blocks below: a failure here
  // must not strand a tenant that is otherwise fully created, and the UI no
  // longer asserts a wrong currency when the row is missing (it renders the
  // bare number instead), so the degradation is honest.
  if (input.primaryCurrency?.trim()) {
    const code = input.primaryCurrency.trim().toUpperCase()
    try {
      await withTenantContext({ orgId: org.id }, (tx) =>
        tx.insert(erpCurrencies).values({
          orgId: org.id,
          code,
          // We know the ISO code, not the localised display name. Use the code
          // for both rather than inventing a name we were not given.
          name: CURRENCY_NAMES[code] ?? code,
          symbol: code,
          isBaseCurrency: true,
        })
      )
    } catch (err) {
      console.warn(`Base-currency seeding failed for org ${org.id} (${code}) (non-fatal):`, err)
    }
  }

  // Wave 113 (VERI Treasure): free/on-by-default for every org, unlike
  // opt-in branches like PMS. Never blocks provisioning on failure.
  // From here on the org EXISTS, so we are legitimately inside a tenant and
  // every remaining write runs as app_runtime with RLS enforcing
  // org_id = current_org_id(). That is R-CRR-23 constraint (4), and it is why
  // the elevated connection above is a single statement rather than a mode.
  try {
    const veriRewardBranch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, "veri_reward") })
    if (veriRewardBranch) {
      await withTenantContext({ orgId: org.id }, (tx) =>
        tx.insert(orgProductBranchEnablements).values({
          orgId: org.id,
          productBranchId: veriRewardBranch.id,
          isEnabled: true,
          enabledAt: new Date(),
        })
      )
    }
  } catch (err) {
    console.warn("VERI Treasure auto-enablement failed (non-fatal):", err)
  }

  // Wave 131: VERI Chat (persistent composer) rolled out platform-wide --
  // same free/on-by-default shape as VERI Treasure above. Never blocks
  // provisioning on failure.
  try {
    const veriChatV2Branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, "veri_chat_v2") })
    if (veriChatV2Branch) {
      await withTenantContext({ orgId: org.id }, (tx) =>
        tx.insert(orgProductBranchEnablements).values({
          orgId: org.id,
          productBranchId: veriChatV2Branch.id,
          isEnabled: true,
          enabledAt: new Date(),
        })
      )
    }
  } catch (err) {
    console.warn("VERI Chat v2 auto-enablement failed (non-fatal):", err)
  }

  // R67 lane I (WS-I item I-03): give the org the current fiscal year and a
  // minimal chart of accounts. Without these, PROJEXA's Annual Budget create
  // screen is correctly-but-permanently disabled-with-reason on a brand-new
  // tenant -- create -> object -> edit -> submit cannot be started at all, on
  // the demo org included (correction C-15). Non-fatal and insert-only, the
  // same posture as the base-currency and product-branch blocks above: a
  // failure here must not strand a tenant that is otherwise fully created, and
  // the Budget screen already degrades honestly when the rows are missing.
  // Idempotent, so re-running provisioning never duplicates either.
  try {
    await provisionFiscalYearAndAccounts(org.id)
  } catch (err) {
    console.warn(`Fiscal-year/chart-of-accounts seeding failed for org ${org.id} (non-fatal):`, err)
  }

  const [dept] = await withTenantContext({ orgId: org.id }, (tx) =>
    tx.insert(departments).values({
      name: "General",
      orgId: org.id,
    }).returning()
  )

  return { organisationId: org.id, defaultDepartmentId: dept.id }
}
