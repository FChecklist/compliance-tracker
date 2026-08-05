import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import PricingContent from "./pricing-content";

// OCID-020 real curl/WebFetch sweep finding, GAP-OCID038-PROJEXA-DOMAIN-
// BRAND-MISMATCH (same class as UMR-20260804-090421-c647's /login fix and
// PR #965's /signup, /mfa-challenge fix, never previously applied here):
// deliberately page-level, not on the root layout -- see
// src/app/layout.tsx's own OCID-038 comment for why a dynamic
// generateMetadata() at the root would force Next.js's dynamic-API
// propagation across the entire route subtree. This page already reads
// headers() in its own body below for the real brand-resolution
// requirement, so it is already real, per-request dynamic regardless --
// adding its own title resolution here costs nothing extra and stays
// scoped to exactly this one route.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  if (!brand) return {};
  return { title: `Pricing — ${brand.brandName}` };
}

// Converted to an async Server Component (the ONLY way to read the real
// HTTP Host header before any login/session exists) so it can resolve the
// real pre-auth brand and hand it down as a plain prop -- PricingContent
// below stays a client component, unchanged in every way except now
// rendering the resolved brand name instead of a hardcoded string.
export default async function PricingPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return <PricingContent brand={brand} />;
}
