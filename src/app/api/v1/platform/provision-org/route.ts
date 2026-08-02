// PLATFORM-01 Wave 1 (Workstream 1, platform-level tenant provisioning).
// Service-to-service endpoint: a sibling product's own BACKEND (starting
// with PROJEXA) calls this at ITS OWN signup time to provision a fresh,
// isolated VERIDIAN org for one of its customers, instead of every
// customer sharing one hardcoded VERIDIAN API key (the exact gap this
// wave closes -- see PLATFORM_STRATEGY.md section 6.12 and
// C:\Users\Dell\.claude\plans\floating-launching-lagoon.md Workstream 1).
//
// Authenticated ONLY by a platform_applications bearer token
// (Authorization: Bearer pk_...) -- deliberately NOT requireAuth() and NOT
// requireAuthOrApiKey(), since neither a human session nor a customer's
// own vk_... apiKeys key is a valid caller here. A leaked customer vk_...
// key must never be able to provision new orgs; a leaked platform pk_...
// key must never be able to read/write one specific customer's data.
import { NextRequest, NextResponse } from "next/server"
import { db, apiKeys, productBranches, orgProductBranchEnablements } from "@/lib/db"
import { eq, inArray } from "drizzle-orm"
import { validatePlatformApplicationKey } from "@/lib/supabase/platform-application-auth"
import { provisionOrganisation } from "@/lib/services/org-provisioning-service"
import { hashSHA256, generateApiKey } from "@/lib/api-keys"

// Which product_branches (beyond the 2 free/on-by-default ones
// provisionOrganisation() already enables for every org: veri_reward,
// veri_chat_v2) a given calling application's own product needs enabled for
// its own routes to actually work. Deliberately NOT generalized into
// provisionOrganisation() itself (that helper stays product-agnostic,
// shared by the human-signup path too, which has no concept of "which
// product's routes will this org's users hit"). Confirmed exact requirement
// for 'projexa' via PROJEXA-MODULE-ENTITLEMENT-01 (Priority 16 Part 2,
// drizzle/0201_projexa_demo_org_erp_sales_hr_enablement.sql): erp/sales are
// real gates (requireErpEnabled()/requireSalesEnabled()) that 502 most of
// PROJEXA's Sales/CRM+ERP surface (Vendors, Materials, Accounting, Invoices,
// Payroll, Budgets, Sales Dashboard, Leads, Customers, Opportunities,
// Quotations, Sales Orders) when missing; construction is PROJEXA's own
// core domain; hr is included for parity with the demo org even though no
// route currently gates on it (future-proofing, same reasoning as that
// migration's own note). Without this, every NEW PROJEXA customer signing
// up via this endpoint would hit the exact same 502 wall the demo org had
// before that fix -- this closes that for new orgs going forward.
const REQUIRED_BRANCHES_BY_APPLICATION: Record<string, string[]> = {
  projexa: ["construction", "erp", "sales", "hr"],
}

export async function POST(request: NextRequest) {
  const authResult = await validatePlatformApplicationKey(request)
  if (authResult.status !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const platformApp = authResult.context

  let body: { customerOrgName?: unknown; country?: unknown; primaryCurrency?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const customerOrgName = typeof body.customerOrgName === "string" ? body.customerOrgName.trim() : ""
  if (!customerOrgName) {
    return NextResponse.json({ error: "customerOrgName is required" }, { status: 400 })
  }
  const country = typeof body.country === "string" && body.country.trim() ? body.country.trim() : "IN"
  const primaryCurrency = typeof body.primaryCurrency === "string" && body.primaryCurrency.trim() ? body.primaryCurrency.trim() : "INR"

  try {
    // Resolve the calling application's own product-branch row by its
    // applicationKey (e.g. the 'projexa' platform_applications row always
    // tags new orgs as PROJEXA orgs) -- look up first, create if this is
    // the first org this application has ever provisioned and no matching
    // catalog row exists yet. Uses the raw (RLS-bypassing) db client
    // deliberately, same posture as productBranches elsewhere in this
    // codebase (a global catalog table, not org-scoped).
    let branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, platformApp.applicationKey) })
    if (!branch) {
      const [created] = await db.insert(productBranches).values({
        branchKey: platformApp.applicationKey,
        displayName: platformApp.displayName,
        domain: platformApp.applicationKey,
        status: "live",
      }).returning()
      branch = created
    }

    const { organisationId } = await provisionOrganisation({
      name: customerOrgName,
      country,
      primaryCurrency,
      primaryProductBranchId: branch.id,
    })

    // Enable the calling application's own required product branches (see
    // REQUIRED_BRANCHES_BY_APPLICATION above) -- same non-fatal-on-failure
    // posture provisionOrganisation() already uses for VERI Reward/VERI
    // Chat v2, so a branch-enablement hiccup doesn't fail the whole
    // provisioning call (the org and its API key are still usable; a
    // missing branch just means that specific module 403s, not a broken
    // signup).
    const requiredBranchKeys = REQUIRED_BRANCHES_BY_APPLICATION[platformApp.applicationKey]
    if (requiredBranchKeys?.length) {
      try {
        const requiredBranches = await db.query.productBranches.findMany({
          where: inArray(productBranches.branchKey, requiredBranchKeys),
        })
        if (requiredBranches.length) {
          await db.insert(orgProductBranchEnablements).values(
            requiredBranches.map((rb) => ({
              orgId: organisationId,
              productBranchId: rb.id,
              isEnabled: true,
              enabledAt: new Date(),
            }))
          )
        }
      } catch (err) {
        console.warn(`Required branch enablement failed for application '${platformApp.applicationKey}' (non-fatal):`, err)
      }
    }

    // Mint one vk_... key scoped to just this new org, tagged to the
    // calling platform application -- the exact same generateApiKey()/
    // hashSHA256() helpers the existing human-facing POST
    // /api/settings/api-keys uses, so a key minted here is indistinguishable
    // in format from a human-generated one (only issuedForApplicationId
    // marks the difference). Uses the raw db client, matching
    // provisionOrganisation()'s own posture immediately above -- minting
    // the new org's first credential is part of the same platform-level
    // bootstrap operation as creating the org itself (the same reasoning
    // autoProvisionUser() already applies to creating the first users row
    // into an org it just created).
    const rawKey = generateApiKey()
    const keyHash = await hashSHA256(rawKey)
    const keyPrefix = rawKey.substring(0, 8) + "..."

    await db.insert(apiKeys).values({
      name: `${platformApp.displayName} (provisioned)`,
      keyHash,
      keyPrefix,
      orgId: organisationId,
      scopes: "read,write",
      isActive: true,
      issuedForApplicationId: platformApp.id,
    })

    // Return the FULL key ONLY on creation -- never retrievable again after
    // this response, identical contract to the existing human-facing
    // POST /api/settings/api-keys endpoint.
    return NextResponse.json({ organisationId, apiKey: rawKey }, { status: 201 })
  } catch (error) {
    console.error("Platform org provisioning error:", error)
    return NextResponse.json({ error: "Failed to provision organisation" }, { status: 500 })
  }
}
