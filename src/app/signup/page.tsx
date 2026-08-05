import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { SignupForm } from "./signup-form";

// GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH addendum (this fix): mirrors
// src/app/login/page.tsx's own generateMetadata() (added by the Stage 1
// pre-authentication domain-based brand resolution work, PR #886) --
// deliberately page-level, not on the root layout, for the same reason
// login/page.tsx documents: headers() in the root layout's own
// generateMetadata() forces Next.js's dynamic-API propagation across the
// ENTIRE route subtree, silently converting every other static page in the
// app to dynamic too. This page already reads headers() in its own body
// below for the real brand-resolution requirement, so it is already real,
// per-request dynamic regardless -- adding its own title resolution here
// costs nothing extra and stays scoped to exactly this one route.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  if (!brand) return {};
  return { title: `Sign up — ${brand.brandName}` };
}

// GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH addendum (this fix): this page
// was a 100% "use client" component that hardcoded "VERIDIAN AI" (both on
// its main form and its post-signup "check your email" success state) --
// the exact same real gap independently found and fixed on
// src/app/login/page.tsx / login-form.tsx by the Stage 1 pre-authentication
// domain-based brand resolution work (PR #886), which this page was simply
// never updated to also use. Converted to an async Server Component (the
// ONLY way to read the real HTTP Host header before any login/session
// exists) so it can resolve the real pre-auth brand and hand it down as a
// plain prop -- SignupForm (moved to its own file, ./signup-form.tsx,
// mirroring login-form.tsx's own split) stays a client component, unchanged
// in every way except now rendering the resolved brand name instead of a
// hardcoded string. No new resolution mechanism: reuses
// resolvePreAuthBrandByHost() exactly as login/page.tsx already does.
export default async function SignupPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SignupForm brand={brand} />
    </Suspense>
  );
}
