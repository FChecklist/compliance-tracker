import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { LoginForm } from "./login-form";

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-navy">
      <Loader2 className="size-8 text-ct-saffron-text animate-spin" />
    </div>
  );
}

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, Stage 1 real
// implementation (UMR-20260804-090421-c647): deliberately page-level, not
// on the root layout -- a real, independent review of this branch's first
// attempt correctly caught that headers() in the root layout's own
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
  return { title: `Sign in — ${brand.brandName}` };
}

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, Stage 1 real
// implementation (UMR-20260804-090421-c647): this page was a 100% "use
// client" component that hardcoded "VERIDIAN AI" -- a real, separate gap
// alongside resolveBranding() itself being org-scoped/post-login only,
// disclosed honestly rather than assumed away. Converted to an async Server
// Component (the ONLY way to read the real HTTP Host header before any
// login/session exists) so it can resolve the real pre-auth brand and hand
// it down as a plain prop -- LoginForm below stays a client component,
// unchanged in every way except now rendering the resolved brand name
// instead of a hardcoded string.
export default async function LoginPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm brand={brand} />
    </Suspense>
  );
}