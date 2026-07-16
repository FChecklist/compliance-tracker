// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding", 2026-07-17): organisations.logo has existed since drizzle/0000
// and was never read or written anywhere in src/ before this wave --
// confirmed via a fresh grep of the codebase immediately before writing the
// migration that added the 4 sibling columns below it
// (drizzle/0219_wave_b_white_label_branding.sql). This service is the single
// place that reads/writes/validates per-org branding, mirroring
// org-license-service.ts's own plain-`db`-import shape (no withTenantContext
// wrapper -- these are single-row-by-orgId reads/writes against
// organisations itself, the same precedent org-license-service.ts and
// cost-guard.ts already established for this exact table).
import { db, organisations } from "@/lib/db"
import { eq, and, ne } from "drizzle-orm"
import { createClient } from "@supabase/supabase-js"

export const ORG_BRANDING_BUCKET = "org-branding"

// getPublicUrl() is a pure string-formatting call (no network round-trip),
// so an anon-key client is fine here -- this is a read-only URL builder,
// never used to write. Actual writes go through the service-role client in
// the upload route (matching documents/route.ts's own admin-client split
// between "who can construct a URL" vs "who can actually touch storage").

// Matches VERIDIAN AI's own default design tokens (src/app/globals.css --
// --color-ct-navy / --color-ct-saffron) so an org that never configures
// branding renders pixel-identical to before this wave, and so the
// Branding settings UI has a real, correct starting point to show instead
// of a blank/guessed color.
export const DEFAULT_BRAND_PRIMARY_COLOR = "#1C2B3A"
export const DEFAULT_BRAND_ACCENT_COLOR = "#F5820A"
export const DEFAULT_LOGO_URL: string | null = null // falls back to /logo-mark.svg client-side

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
// Deliberately permissive (not a full RFC 1035 validator) -- this is a
// requested-domain string, not something this migration wave actually
// verifies or routes traffic to (see the migration file's own header for
// why DNS/TLS/routing are explicitly descoped). The point of this regex is
// only to reject obviously-wrong input (URLs with a scheme, paths, spaces),
// not to be the source of truth for domain validity.
const DOMAIN_RE = /^(?!https?:\/\/)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

export interface OrgBranding {
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  accentColor: string
  customDomain: string | null
  emailSenderName: string | null
  // true once ANY field has been explicitly configured by an admin -- lets
  // the UI/preview distinguish "this IS the default" from "this org chose
  // colors that happen to match the default."
  isCustomized: boolean
}

export class OrgBrandingValidationError extends Error {}

// Never throws, never returns partial/undefined branding -- an org row that
// doesn't exist (shouldn't happen for an authenticated request, but this is
// still defense-in-depth) or one where every column is NULL both resolve to
// the exact same safe default object. This is the ONLY function any render
// path (API routes, /api/me) should call -- callers must never read
// org.brandPrimaryColor etc. directly, or they'd have to re-implement this
// fallback themselves and risk a blank/broken UI for the common case (an
// org that hasn't configured branding at all).
// organisations.logo/faviconUrl store the object's PATH within
// ORG_BRANDING_BUCKET (e.g. "org_123/logo-abc.png"), not a full URL --
// matching documents.fileUrl's own precedent (documents/route.ts stores the
// bucket-relative path, [id]/route.ts resolves it to a real URL on read).
// The org-branding bucket is public (see the migration's header for why),
// so this resolves to a stable public URL rather than a short-lived signed
// one -- no repeated signing needed for something rendered on every page.
function publicUrlFor(objectPath: string | null): string | null {
  if (!objectPath) return null
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return null
  const client = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")
  const { data } = client.storage.from(ORG_BRANDING_BUCKET).getPublicUrl(objectPath)
  return data.publicUrl
}

export async function resolveBranding(orgId: string): Promise<OrgBranding> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  const logoUrl = publicUrlFor(org?.logo ?? null) || DEFAULT_LOGO_URL
  const faviconUrl = publicUrlFor(org?.faviconUrl ?? null)
  const primaryColor = org?.brandPrimaryColor || DEFAULT_BRAND_PRIMARY_COLOR
  const accentColor = org?.brandAccentColor || DEFAULT_BRAND_ACCENT_COLOR
  const customDomain = org?.customDomain || null
  const emailSenderName = org?.emailSenderName || null
  return {
    logoUrl,
    faviconUrl,
    primaryColor,
    accentColor,
    customDomain,
    emailSenderName,
    isCustomized: Boolean(org?.logo || org?.faviconUrl || org?.brandPrimaryColor || org?.brandAccentColor || org?.customDomain || org?.emailSenderName),
  }
}

export interface BrandingUpdateInput {
  primaryColor?: string | null
  accentColor?: string | null
  customDomain?: string | null
  emailSenderName?: string | null
}

// Validates and persists the text-field portion of branding (colors/domain/
// sender name). Logo/favicon go through updateBrandingAsset() below instead
// -- they're set as a side effect of a successful storage upload, never as
// a bare string the client hands us (a client-supplied arbitrary URL here
// would let an org "logo" point anywhere, including to bypass the org's own
// storage-bucket scoping).
export async function updateBranding(orgId: string, input: BrandingUpdateInput): Promise<OrgBranding> {
  const patch: Partial<typeof organisations.$inferInsert> = {}

  if (input.primaryColor !== undefined) {
    if (input.primaryColor === null || input.primaryColor === "") {
      patch.brandPrimaryColor = null
    } else {
      if (!HEX_COLOR_RE.test(input.primaryColor)) {
        throw new OrgBrandingValidationError("primaryColor must be a 6-digit hex color, e.g. #1C2B3A")
      }
      patch.brandPrimaryColor = input.primaryColor
    }
  }

  if (input.accentColor !== undefined) {
    if (input.accentColor === null || input.accentColor === "") {
      patch.brandAccentColor = null
    } else {
      if (!HEX_COLOR_RE.test(input.accentColor)) {
        throw new OrgBrandingValidationError("accentColor must be a 6-digit hex color, e.g. #F5820A")
      }
      patch.brandAccentColor = input.accentColor
    }
  }

  if (input.customDomain !== undefined) {
    if (input.customDomain === null || input.customDomain.trim() === "") {
      patch.customDomain = null
    } else {
      const normalized = input.customDomain.trim().toLowerCase()
      if (!DOMAIN_RE.test(normalized)) {
        throw new OrgBrandingValidationError("customDomain must be a bare domain, e.g. reports.acme.com (no https://, path, or spaces)")
      }
      const existing = await db.query.organisations.findFirst({
        where: and(eq(organisations.customDomain, normalized), ne(organisations.id, orgId)),
      })
      if (existing) {
        throw new OrgBrandingValidationError("That custom domain is already registered to another organisation")
      }
      patch.customDomain = normalized
    }
  }

  if (input.emailSenderName !== undefined) {
    const trimmed = input.emailSenderName?.trim() || null
    if (trimmed && trimmed.length > 100) {
      throw new OrgBrandingValidationError("emailSenderName must be 100 characters or fewer")
    }
    patch.emailSenderName = trimmed
  }

  if (Object.keys(patch).length > 0) {
    await db.update(organisations).set(patch).where(eq(organisations.id, orgId))
  }

  return resolveBranding(orgId)
}

// Called only from the logo/favicon upload route after a successful
// Supabase Storage upload -- `objectPath` is always this server's own
// upload path, never client-supplied, and null means "remove/reset to
// default" (the route's DELETE handler).
export async function updateBrandingAsset(orgId: string, kind: "logo" | "favicon", objectPath: string | null): Promise<OrgBranding> {
  if (kind === "logo") {
    await db.update(organisations).set({ logo: objectPath }).where(eq(organisations.id, orgId))
  } else {
    await db.update(organisations).set({ faviconUrl: objectPath }).where(eq(organisations.id, orgId))
  }
  return resolveBranding(orgId)
}

// Returns the current object path (not the public URL) for a given asset
// kind -- used by the upload route to delete the previous object from
// storage when an admin replaces their logo/favicon, so orphaned objects
// don't pile up in the bucket indefinitely.
export async function getBrandingAssetPath(orgId: string, kind: "logo" | "favicon"): Promise<string | null> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  return (kind === "logo" ? org?.logo : org?.faviconUrl) ?? null
}
