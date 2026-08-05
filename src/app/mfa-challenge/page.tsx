import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import MfaChallengeForm from "./mfa-challenge-form";

// OCID-020 real comprehensive browser certification finding, GAP-OCID038-
// PROJEXA-DOMAIN-BRAND-MISMATCH (same class as UMR-20260804-090421-c647's
// /login fix, never previously applied here): deliberately page-level, not
// on the root layout -- see src/app/layout.tsx's own OCID-038 comment.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  if (!brand) return {};
  return { title: `Two-factor verification — ${brand.brandName}` };
}

// This page was a 100% "use client" component that hardcoded "VERIDIAN AI"
// in both the visible wordmark and the browser tab title (inherited,
// unoverridden, from the root layout's generic metadata). Converted to an
// async Server Component so it can resolve the real pre-auth brand and
// hand it down as a plain prop -- MfaChallengeForm below stays a client
// component, unchanged except for now rendering the resolved brand name.
export default async function MfaChallengePage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return <MfaChallengeForm brand={brand} />;
}
