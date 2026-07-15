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
import { db, organisations, departments, productBranches, orgProductBranchEnablements } from "@/lib/db"
import { eq } from "drizzle-orm"

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
  // Accepted for forward-compatibility with the later Workstream 4
  // (multi-currency) / Workstream 6 (per-country compliance) waves --
  // explicitly OUT OF SCOPE for this wave. organisations has no `country`
  // column and no currency FK yet, so neither value is persisted anywhere
  // by this function today; they are accepted (not silently dropped by a
  // TypeScript error) so a future wave can wire real persistence without
  // changing this function's call signature or its callers.
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
  while (await db.query.organisations.findFirst({ where: eq(organisations.slug, slug) })) {
    attempt += 1
    slug = `${baseSlug}-${attempt}`
    if (attempt > 20) break // pathological collision case, give up gracefully
  }

  const [org] = await db.insert(organisations).values({
    name: orgName,
    slug,
    plan: "free",
    primaryProductBranchId: input.primaryProductBranchId ?? null,
  }).returning()

  // Wave 113 (VERI Treasure): free/on-by-default for every org, unlike
  // opt-in branches like PMS. Never blocks provisioning on failure.
  try {
    const veriRewardBranch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, "veri_reward") })
    if (veriRewardBranch) {
      await db.insert(orgProductBranchEnablements).values({
        orgId: org.id,
        productBranchId: veriRewardBranch.id,
        isEnabled: true,
        enabledAt: new Date(),
      })
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
      await db.insert(orgProductBranchEnablements).values({
        orgId: org.id,
        productBranchId: veriChatV2Branch.id,
        isEnabled: true,
        enabledAt: new Date(),
      })
    }
  } catch (err) {
    console.warn("VERI Chat v2 auto-enablement failed (non-fatal):", err)
  }

  const [dept] = await db.insert(departments).values({
    name: "General",
    orgId: org.id,
  }).returning()

  return { organisationId: org.id, defaultDepartmentId: dept.id }
}
