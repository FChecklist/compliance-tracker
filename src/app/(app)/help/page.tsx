import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { createClient } from "@/lib/supabase/server";
import { HelpCentreContent } from "./help-center-content";

// OCID-020 category 23 real fix (2026-08-14, UX audit heuristic 10 "Help
// and documentation", severity 3): confirmed root cause via src/proxy.ts +
// scripts/generate-protected-routes.mjs -- /help's directory living under
// src/app/(app)/ meant PROTECTED_APP_ROUTE_PREFIXES (generated from that
// directory listing) always included "/help", so proxy.ts redirected every
// unauthenticated /help request to /login before this page ever rendered
// -- confirmed live via `curl -sI https://projexa-ai.com/help` (307 to
// /login?redirectTo=%2Fhelp, no x-matched-path/x-powered-by header, i.e.
// the redirect happens before Next.js even routes the request) and by
// reading src/proxy.ts's real PROTECTED_APP_ROUTE_PREFIXES.some(prefix =>
// pathname.startsWith(prefix)) check directly. /help is now the one
// documented exception in generate-protected-routes.mjs's own allowlist
// (PUBLIC_APP_ROUTE_EXCEPTIONS), and this page itself now serves both
// audiences: a real, useful FAQ for an anonymous pre-auth visitor (the
// audit's actual ask -- a real path forward, not a dead end into a login
// wall), and the existing full in-app help center (unchanged, just moved
// into help-center-content.tsx) for anyone already signed in. A separate
// route at plain /help (outside the (app) group) was considered and
// rejected: Next.js does not allow two page.tsx files resolving to the
// same path, and this one file already needs to distinguish the two
// audiences at render time regardless.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  return { title: `Help — ${brand?.brandName ?? "VERIDIAN AI"}` };
}

const FAQS = [
  {
    q: "How do I get started?",
    a: "Create a free account from the Sign up page — no credit card required for the Starter plan. Once you're in, you can invite teammates and start tracking compliance items right away.",
  },
  {
    q: "I can't sign in — what should I do?",
    a: "Double-check the email and password you're using match the account you signed up with. If you signed up with Google or SSO, use that same method to sign in. Still stuck? Reach out via the Contact Us page and we'll help you get back in.",
  },
  {
    q: "Where can I see pricing and plan details?",
    a: "The Pricing page has a full breakdown of every plan, what's included, and answers to common billing questions.",
  },
  {
    q: "How do I reach a real person?",
    a: "The Contact Us page reaches our team directly for anything not covered here — account issues, sales questions, or general feedback.",
  },
];

async function PreAuthHelp() {
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
          <div className="hidden items-center gap-8 text-sm text-[#1a1a17]/70 md:flex">
            <Link href="/pricing" className="hover:text-[#1a1a17]">Pricing</Link>
            <Link href="/login" className="hover:text-[#1a1a17]">Log in</Link>
            <Link
              href="/contact"
              className="rounded-full border border-[#1a1a17]/20 px-5 py-2 text-sm bg-[#1a1a17] text-[#F4F1E8]"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-2xl px-6 pt-20 pb-24 md:pt-28">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/65">Help</div>
        <h1 className="mt-4 max-w-xl font-heading text-4xl leading-tight sm:text-5xl">
          How can we help?
        </h1>
        <p className="mt-5 max-w-lg leading-relaxed text-[#1a1a17]/70">
          Answers to the most common questions. Already have an account?{" "}
          <Link href="/login" className="underline hover:text-[#1a1a17]">Sign in</Link> to reach the full
          help center from inside the app.
        </p>

        <div className="mt-12 space-y-6">
          {FAQS.map((faq) => (
            <div key={faq.q} className="border-b border-[#1a1a17]/10 pb-6">
              <h2 className="font-heading text-lg">{faq.q}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#1a1a17]/70">{faq.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
          <Link
            href="/contact"
            className="rounded-full border border-[#1a1a17]/20 px-5 py-2 hover:bg-[#1a1a17]/5"
          >
            Contact us
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-[#1a1a17]/20 px-5 py-2 hover:bg-[#1a1a17]/5"
          >
            View pricing
          </Link>
        </div>
      </section>

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
          <div className="text-sm text-[#1a1a17]/65">© {new Date().getFullYear()} {brandName}</div>
        </div>
      </footer>
    </main>
  );
}

export default async function HelpPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <PreAuthHelp />;
  }

  return <HelpCentreContent />;
}
