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
import { db, apiKeys, productBranches } from "@/lib/db"
import { eq } from "drizzle-orm"
import { validatePlatformApplicationKey } from "@/lib/supabase/platform-application-auth"
import { provisionOrganisation } from "@/lib/services/org-provisioning-service"
import { hashSHA256, generateApiKey } from "@/lib/api-keys"

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
