import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { ContactUsForm } from "@/components/ContactUsForm";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, continuing Stage 1
// (UMR-20260804-090421-c647) to /contact, same pattern as src/app/login/
// page.tsx. Real UX audit finding (OCID-020 category 23, 2026-08-14
// evidence_json, heuristic 2): /contact's static title hardcoded
// "VERIDIAN AI" while /login correctly showed the host-resolved brand.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  return { title: `Contact Us — ${brand?.brandName ?? "VERIDIAN AI"}` };
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const { confirmed } = await searchParams;
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  const brandName = brand?.brandName ?? "VERIDIAN AI";

  return (
    <main className="min-h-screen bg-[#F4F1E8] text-[#1a1a17] antialiased">
      <nav className="border-b border-[#1a1a17]/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg tracking-tight">
            <Image src="/logo-mark.svg" alt={brandName} width={28} height={28} priority />
            <span>{brandName}</span>
          </Link>
          {/* OCID-020 category 23 fix (2026-08-14, real UX audit H2/H4):
              "On cost" -> "Pricing" (the conventional label /pricing itself
              uses, per the audit's heuristic-2 finding) and links to the
              real /pricing route instead of an in-page anchor that doesn't
              exist on this page. */}
          <div className="hidden items-center gap-8 text-sm text-[#1a1a17]/70 md:flex">
            <Link href="/#research" className="hover:text-[#1a1a17]">Research</Link>
            <Link href="/#products" className="hover:text-[#1a1a17]">Products</Link>
            <Link href="/pricing" className="hover:text-[#1a1a17]">Pricing</Link>
            <Link href="/join-us" className="hover:text-[#1a1a17]">Join Us</Link>
          </div>
          <Link
            href="/contact"
            className="rounded-full border border-[#1a1a17]/20 px-5 py-2 text-sm bg-[#1a1a17] text-[#F4F1E8]"
          >
            Contact Us
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-2xl px-6 pt-20 pb-24 md:pt-28">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">Get in touch</div>
        <h1 className="mt-4 max-w-xl font-heading text-4xl leading-tight sm:text-5xl">
          Contact Us
        </h1>
        <p className="mt-5 max-w-lg leading-relaxed text-[#1a1a17]/70">
          Questions about a product, a partnership, or anything else — tell us a bit about yourself and
          we&apos;ll get back to you.
        </p>

        {confirmed === "1" && (
          <div className="mt-6 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-5 py-3 text-sm text-emerald-800">
            Your email is confirmed — thanks!
          </div>
        )}
        {confirmed === "0" && (
          <div className="mt-6 rounded-xl border border-red-600/30 bg-red-600/10 px-5 py-3 text-sm text-red-800">
            That confirmation link isn&apos;t valid or has expired.
          </div>
        )}

        <div className="mt-12">
          <ContactUsForm />
        </div>
      </section>

      {/* OCID-020 category 23 fix (2026-08-14, real UX audit H4): real
          footer links (Home, Pricing, Log in) matching /pricing's own
          footer link set -- the audit found /contact had no footer links
          at all while /pricing had this exact set, a real consistency
          gap. */}
      <footer className="border-t border-[#1a1a17]/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 font-heading">
            <Image src="/logo-mark.svg" alt={brandName} width={22} height={22} />
            <span>{brandName}</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#1a1a17]/70">
            <Link href="/" className="hover:text-[#1a1a17]">Home</Link>
            <Link href="/pricing" className="hover:text-[#1a1a17]">Pricing</Link>
            <Link href="/login" className="hover:text-[#1a1a17]">Log in</Link>
          </div>
          <div className="text-sm text-[#1a1a17]/50">© {new Date().getFullYear()} {brandName}</div>
        </div>
      </footer>
    </main>
  );
}
