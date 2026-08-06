import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { PricingContent } from "./pricing-content";

// OCID-020 child UMR-20260805-142629-8087 ("broader pre-auth brand
// mismatch"): this page hardcoded "VERIDIAN AI" throughout its nav, FAQ
// copy, CTA banner, and footer even when the request comes in on a
// resolved brand's own domain (e.g. projexa-ai.com). Applies the exact
// same fix pattern already merged for src/app/login/page.tsx +
// login-form.tsx (PR #886) -- deliberately page-level, not the root
// layout (see layout.tsx's own comment on why a root-layout
// generateMetadata() would silently force the whole route subtree
// dynamic).
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  if (!brand) return {};
  return { title: `Pricing — ${brand.brandName}` };
}

// This page was a 100% "use client" component that hardcoded "VERIDIAN AI"
// (the annual/monthly toggle needs client state, and the animations use
// framer-motion) -- converted to an async Server Component (the only way
// to read the real HTTP Host header before any session exists) that
// resolves the real pre-auth brand and hands it down as a plain prop.
// PricingContent stays a client component, unchanged in every way except
// now rendering the resolved brand name instead of a hardcoded string --
// mirrors login/page.tsx + login-form.tsx's own split exactly.
export default async function PricingPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return <PricingContent brand={brand} />;
}
