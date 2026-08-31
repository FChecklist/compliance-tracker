import { headers } from "next/headers";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import PricingPage from "./pricing-client";

// GAP-PROJEXA-MARKETING-PAGES-HARDCODED-VERIDIAN (OCID-020 addendum,
// 2026-08-05): same root-cause class as GAP-OCID038-PROJEXA-DOMAIN-BRAND-
// MISMATCH already fixed on /login (UMR-20260804-090421-c647) and /signup +
// /mfa-challenge (PR #954) -- this page was 100% "use client" with no brand
// resolution at all, hardcoding the "VERIDIAN AI" wordmark. Mirrors the same
// proven pattern exactly: split into an async Server Component (this file,
// the only way to read the real HTTP Host header before any session
// exists) and an unchanged client component (pricing-client.tsx) now taking
// `brand` as a plain prop. `null` (no host match, the common case) renders
// byte-identical to this page's pre-existing behavior.
export default async function Page() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  return <PricingPage brand={brand} />;
}
