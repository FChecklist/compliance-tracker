// Wave 113: shared shell for the legal pages (/terms, /privacy, /data-policy).
// Server-compatible (no hooks) — paper styling matching the Cognitive root.
// The seller is IT SERVICES BY RAJAT AGARWAL, a sole proprietorship (the trade
// name of Rajat Agarwal, an individual). It is not registered for GST.
import Link from "next/link";
import Image from "next/image";
import type { PreAuthBrand } from "@/lib/services/org-branding-service";

export const COMPANY = {
  legalName: "IT SERVICES BY RAJAT AGARWAL",
  jurisdiction: "India",
  description: "a sole proprietorship in India, the trade name of Rajat Agarwal, an individual",
  address: "B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India",
  phone: "+91 96503 97480",
  gstNote: "Not registered for GST. GST is not charged.",
  brand: "VERIDIAN AI OS",
  contactEmail: "rajatsiroffice@gmail.com",
};

// GAP-PROJEXA-MARKETING-PAGES-HARDCODED-VERIDIAN (OCID-020 addendum,
// 2026-08-05): `brand` is optional and defaults to undefined/null-safe --
// /data-policy (the third page sharing this shell) passes nothing and
// renders byte-identical to before this change; /terms and /privacy pass
// the real per-host brand resolved by their own async page.tsx, same
// resolvePreAuthBrandByHost() contract /login already uses. Deliberately
// only swaps the nav wordmark + footer attribution line -- the legal body
// content each page renders as `children` names the real legal entity and
// product bundle, which does not change per visiting host.
export function LegalShell({ title, updated, brand, children }: { title: string; updated: string; brand?: PreAuthBrand | null; children: React.ReactNode }) {
  const brandLabel = brand?.brandName ?? COMPANY.brand;
  return (
    <main className="min-h-screen bg-[#F4F1E8] text-[#1a1a17] antialiased">
      <nav className="border-b border-[#1a1a17]/10">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg tracking-tight">
            <Image src="/logo-mark.svg" alt={brand?.brandName ?? "VERIDIAN"} width={24} height={24} />
            {brand ? (
              <span>{brand.brandName}</span>
            ) : (
              <span>VERIDIAN <span className="text-[#1a1a17]/65">COGNITIVE AI OS</span></span>
            )}
          </Link>
          <div className="flex gap-5 text-sm text-[#1a1a17]/65">
            <Link href="/terms" className="hover:text-[#1a1a17]">Terms</Link>
            <Link href="/privacy" className="hover:text-[#1a1a17]">Privacy</Link>
            <Link href="/data-policy" className="hover:text-[#1a1a17]">Data</Link>
            <Link href="/disclaimer" className="hover:text-[#1a1a17]">Disclaimer</Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="font-heading text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[#1a1a17]/65">Last updated: {updated}</p>
        <div className="legal-prose mt-10 space-y-8 leading-relaxed text-[#1a1a17]/80 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-[#1a1a17] [&_h3]:font-semibold [&_h3]:text-[#1a1a17] [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_p+p]:mt-3">
          {children}
        </div>
      </article>

      <footer className="border-t border-[#1a1a17]/10">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-6 py-8 text-xs text-[#1a1a17]/65">
          <span>
            {brandLabel} is owned and operated by {COMPANY.legalName}, {COMPANY.description}.
          </span>
          <span>© {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
