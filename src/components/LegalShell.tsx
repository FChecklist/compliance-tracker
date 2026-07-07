// Wave 113: shared shell for the legal pages (/terms, /privacy, /data-policy).
// Server-compatible (no hooks) — paper styling matching the Cognitive root.
// DIRECTOR-PROTECTION NOTE: these pages intentionally publish the corporate
// identity ONLY (legal name + jurisdiction) — never director names, DINs, or
// personal addresses. Statutory particulars (CIN, registered office) should
// be added by the owner where marked; they are required on official company
// publications under the Companies Act but were not available to publish at
// build time.
import Link from "next/link";
import Image from "next/image";

export const COMPANY = {
  legalName: "SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED",
  jurisdiction: "India",
  incorporation: "incorporated in India under the Companies Act",
  brand: "VERIDIAN AI OS",
  contactEmail: "raajat.agarwal@gmail.com", // swap for a branded legal/compliance inbox when available
};

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F4F1E8] text-[#1a1a17] antialiased">
      <nav className="border-b border-[#1a1a17]/10">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg tracking-tight">
            <Image src="/logo-mark.svg" alt="VERIDIAN" width={24} height={24} />
            <span>VERIDIAN <span className="text-[#1a1a17]/50">COGNITIVE AI OS</span></span>
          </Link>
          <div className="flex gap-5 text-sm text-[#1a1a17]/60">
            <Link href="/terms" className="hover:text-[#1a1a17]">Terms</Link>
            <Link href="/privacy" className="hover:text-[#1a1a17]">Privacy</Link>
            <Link href="/data-policy" className="hover:text-[#1a1a17]">Data</Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="font-heading text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[#1a1a17]/50">Last updated: {updated}</p>
        <div className="legal-prose mt-10 space-y-8 leading-relaxed text-[#1a1a17]/80 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-[#1a1a17] [&_h3]:font-semibold [&_h3]:text-[#1a1a17] [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_p+p]:mt-3">
          {children}
        </div>
      </article>

      <footer className="border-t border-[#1a1a17]/10">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-6 py-8 text-xs text-[#1a1a17]/50">
          <span>
            {COMPANY.brand} is owned and operated by {COMPANY.legalName}, a company {COMPANY.incorporation}.
          </span>
          <span>© {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
