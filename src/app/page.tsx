// VERIDIAN COGNITIVE AI OS — the site root (Wave 112).
//
// This is the research-lab face of everything built in this repo, styled in
// the register of a frontier-lab homepage (anthropic.com): warm paper
// background, oversized serif statements, hairline rules, an editorial
// product index instead of pricing cards. Deliberately NO pricing anywhere —
// cost is discussed as a philosophy (§ "On cost"), and each product page
// (/office, /the-firm, /veri-fm-cs, /forge) carries its own full selling
// motion. The four "research directions" are not marketing inventions: each
// names a real subsystem shipped in this repo (orchestra-model-resolver's
// four layers, VERIDIAN_AI_CONSTITUTION + policy-enforcement-engine,
// capability-registry-service, orchestra-execution-logger).
//
// Server component on purpose — no state, no client JS beyond Next's own.

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { VisitorIntelligence } from "@/components/VisitorIntelligence";

// Wave 113: the Research nav item on every product page links here with
// ?from=<slug>. A visitor mid-purchase-journey who detours to the lab page
// must not lose the thread — the sticky return pill below hands them straight
// back to the product they were evaluating.
const RETURN_MAP: Record<string, { name: string; href: string }> = {
  office: { name: "VERIDIAN OFFICE AI OS", href: "/office" },
  "the-firm": { name: "THE FIRM AI OS", href: "/the-firm" },
  forge: { name: "FORGE", href: "/forge" },
  "veri-fm-cs": { name: "VERI FM & CS AI OS", href: "/veri-fm-cs" },
};

const PRODUCTS = [
  {
    n: "01",
    name: "VERIDIAN OFFICE AI OS",
    thesis:
      "The complete company — finance, sales, CRM, HR, projects, operations, governance — as one system of 50+ modules, run end-to-end by an AI assistant that works while you decide.",
    href: "/office",
    status: "Live",
  },
  {
    n: "02",
    name: "THE FIRM AI OS",
    thesis:
      "Practice cognition for professional firms — CA, CS, Legal, GRC, Audit. One client roster, one deadline radar, one view of who is overloaded, across every service line.",
    href: "/the-firm",
    status: "Live",
  },
  {
    n: "03",
    name: "VERI FM & CS AI OS",
    thesis:
      "Facilities and corporate services, engineered for the people who actually hold the clipboard — asset registers digitized from photographs, maintenance that schedules itself.",
    href: "/veri-fm-cs",
    status: "Live",
  },
  {
    n: "04",
    name: "FORGE",
    thesis:
      "Custom cognitive systems, engineered to order. The same research, the same platform discipline, applied to a problem that is only yours.",
    href: "/forge",
    status: "Engineering practice",
  },
];

const RESEARCH = [
  {
    title: "Layered cognition",
    body: "A four-layer orchestra — task, assistant, account, and global intelligence — where every request is resolved to the least cognition that answers it well. Frontier reasoning where it matters; none where it doesn't.",
  },
  {
    title: "Purpose-bound intelligence",
    body: "Every agent in the system operates inside a written constitution, enforced in code before a model is ever called. An AI that can act on your business must first be bound to your business — provably, not rhetorically.",
  },
  {
    title: "Capability memory",
    body: "The system remembers what it can already do. Before any new capability is created, semantic search over a registry of existing agents, modules and rules answers first — cognition is reused, never duplicated.",
  },
  {
    title: "Accountable cognition",
    body: "Every AI execution is logged with its model, tokens, cost and outcome. Intelligence you cannot audit is a liability wearing a demo. Ours writes its own ledger, task by task.",
  },
];

export default async function CognitiveRootPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const returnTo = from ? RETURN_MAP[from] : undefined;

  return (
    <main className="min-h-screen bg-[#F4F1E8] text-[#1a1a17] antialiased">
      {/* nav — spare, editorial */}
      <nav className="border-b border-[#1a1a17]/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg tracking-tight">
            <Image src="/logo-mark.svg" alt="VERIDIAN" width={28} height={28} priority />
            <span>
              VERIDIAN <span className="text-[#1a1a17]/50">COGNITIVE AI OS</span>
            </span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-[#1a1a17]/70 md:flex">
            <a href="#research" className="hover:text-[#1a1a17]">Research</a>
            <a href="#products" className="hover:text-[#1a1a17]">Products</a>
            <a href="#cost" className="hover:text-[#1a1a17]">On cost</a>
            <a href="#sales" className="hover:text-[#1a1a17]">Sales</a>
          </div>
          <Link
            href="/login"
            className="rounded-full border border-[#1a1a17]/20 px-5 py-2 text-sm hover:bg-[#1a1a17] hover:text-[#F4F1E8] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* hero — one oversized statement, nothing competing with it */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-20 md:pt-32 md:pb-28">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">
          AI Cognitive Research
        </div>
        <h1 className="mt-8 max-w-4xl font-heading text-5xl leading-[1.06] sm:text-6xl md:text-7xl">
          We research how a business thinks.
          <br />
          Then we build the system that thinks for it.
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-[#1a1a17]/70">
          VERIDIAN is a cognitive research and engineering practice. Our work becomes advanced,
          working products — operating systems that perceive a company&apos;s state, decide,
          act, and account for every action they take.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#products"
            className="group inline-flex items-center gap-2 rounded-full bg-[#1a1a17] px-7 py-3 text-sm font-medium text-[#F4F1E8]"
          >
            Explore the products
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#cost"
            className="inline-flex items-center gap-2 rounded-full border border-[#1a1a17]/20 px-7 py-3 text-sm font-medium hover:bg-[#1a1a17]/5"
          >
            How we think about cost
          </a>
        </div>
      </section>

      {/* the belief — a single serif block, the Anthropic register */}
      <section className="border-y border-[#1a1a17]/10 bg-[#EDE9DC]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <p className="max-w-3xl font-heading text-2xl leading-snug sm:text-3xl md:text-[2.1rem] md:leading-[1.35]">
            Software has spent fifty years waiting to be operated. We believe the next fifty belong
            to systems that operate — bounded by a constitution, accountable to a ledger, and
            humble enough to ask before they act on what matters.
          </p>
          <p className="mt-8 text-sm text-[#1a1a17]/55">
            — The premise behind everything on this page
          </p>
        </div>
      </section>

      {/* research directions — four real subsystems, presented as research */}
      <section id="research" className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">Research directions</div>
        <h2 className="mt-4 max-w-2xl font-heading text-3xl sm:text-4xl">
          Four questions we keep answering in production
        </h2>
        <div className="mt-12 grid gap-x-12 gap-y-12 md:grid-cols-2">
          {RESEARCH.map((r, i) => (
            <div key={r.title} className="border-t border-[#1a1a17]/15 pt-6">
              <div className="text-sm text-[#1a1a17]/40">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-2 font-heading text-xl">{r.title}</h3>
              <p className="mt-3 leading-relaxed text-[#1a1a17]/70">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* product index — editorial rows, no cards, no prices */}
      <section id="products" className="border-y border-[#1a1a17]/10 bg-[#F9F7F0]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">Products & projects</div>
          <h2 className="mt-4 max-w-2xl font-heading text-3xl sm:text-4xl">
            Research that ships
          </h2>
          <div className="mt-12">
            {PRODUCTS.map((p) => (
              <Link
                key={p.n}
                href={p.href}
                className="group grid gap-4 border-t border-[#1a1a17]/15 py-8 last:border-b md:grid-cols-[64px_1fr_96px] md:items-baseline"
              >
                <div className="font-heading text-lg text-[#1a1a17]/35">{p.n}</div>
                <div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="font-heading text-2xl group-hover:underline decoration-1 underline-offset-4">
                      {p.name}
                    </h3>
                    <span className="rounded-full border border-[#1a1a17]/15 px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-[#1a1a17]/55">
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl leading-relaxed text-[#1a1a17]/70">{p.thesis}</p>
                </div>
                <div className="hidden justify-self-end md:block">
                  <ArrowUpRight className="size-5 text-[#1a1a17]/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#1a1a17]" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* on cost — a discussion, deliberately not a price list */}
      <section id="cost" className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">On cost</div>
        <h2 className="mt-4 max-w-2xl font-heading text-3xl sm:text-4xl">
          We discuss cost. We don&apos;t publish price lists.
        </h2>
        <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-3">
          <div className="border-t border-[#1a1a17]/15 pt-6">
            <h3 className="font-heading text-lg">Cost follows cognition</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-[#1a1a17]/70">
              A system that thinks harder should cost more only when it thinks harder. Every AI
              execution in our platforms is metered — model, tokens, outcome — so what you pay
              tracks what was actually reasoned about, not how many chairs you own.
            </p>
          </div>
          <div className="border-t border-[#1a1a17]/15 pt-6">
            <h3 className="font-heading text-lg">Your intelligence, your bill</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-[#1a1a17]/70">
              Bring your own model keys and pay providers at their rates, with our routing choosing
              the least expensive layer that answers well. We refuse to make a margin on marked-up
              tokens — that incentive corrupts the engineering.
            </p>
          </div>
          <div className="border-t border-[#1a1a17]/15 pt-6">
            <h3 className="font-heading text-lg">Rent is the anomaly</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-[#1a1a17]/70">
              Custom systems are priced as engineering, once — not as perpetual per-seat rent.
              Where a product has a subscription, it covers the running of the system, and the
              conversation about what that should be is one we have openly, per engagement.
            </p>
          </div>
        </div>
        <p className="mt-10 max-w-2xl text-sm text-[#1a1a17]/55">
          Each product page carries its own commercial details. For anything bespoke, the cost
          conversation starts with your problem, not our rate card.
        </p>
      </section>

      {/* sales — one organisation, four doors */}
      <section id="sales" className="border-t border-[#1a1a17]/10 bg-[#EDE9DC]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="grid gap-10 md:grid-cols-2 md:items-start">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#1a1a17]/50">Sales</div>
              <h2 className="mt-4 font-heading text-3xl sm:text-4xl">
                One sales organisation,
                <br />
                everything we build
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-[#1a1a17]/70">
                Demos, guided walkthroughs and the partner programme for every VERIDIAN product run
                through a single team — VERIDIAN AI OS Sales — so partners carry one link, one
                dashboard, one commission ledger across the whole portfolio.
              </p>
            </div>
            <div className="grid gap-3">
              {PRODUCTS.map((p) => (
                <Link
                  key={p.href}
                  href={`${p.href}#sales`}
                  className="group flex items-center justify-between rounded-xl border border-[#1a1a17]/15 bg-[#F9F7F0] px-5 py-4 transition-colors hover:border-[#1a1a17]/40"
                >
                  <span className="text-sm font-medium">{p.name} — demos & partners</span>
                  <ArrowRight className="size-4 text-[#1a1a17]/40 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-[#1a1a17]/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 font-heading">
            <Image src="/logo-mark.svg" alt="VERIDIAN" width={22} height={22} />
            <span>VERIDIAN <span className="text-[#1a1a17]/50">COGNITIVE AI OS</span></span>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm text-[#1a1a17]/60">
            <Link href="/office" className="hover:text-[#1a1a17]">Office</Link>
            <Link href="/the-firm" className="hover:text-[#1a1a17]">The Firm</Link>
            <Link href="/veri-fm-cs" className="hover:text-[#1a1a17]">FM & CS</Link>
            <Link href="/forge" className="hover:text-[#1a1a17]">Forge</Link>
            <Link href="/login" className="hover:text-[#1a1a17]">Sign in</Link>
          </div>
          <div className="text-sm text-[#1a1a17]/50">© {new Date().getFullYear()} VERIDIAN AI</div>
        </div>
        <div className="border-t border-[#1a1a17]/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-5 text-xs text-[#1a1a17]/50 md:flex-row md:items-center md:justify-between">
            <span>
              VERIDIAN AI OS is owned and operated by SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED, a company
              incorporated in India under the Companies Act.
            </span>
            <span className="flex gap-5">
              <Link href="/terms" className="hover:text-[#1a1a17]">Terms & Conditions</Link>
              <Link href="/privacy" className="hover:text-[#1a1a17]">Privacy Policy</Link>
              <Link href="/data-policy" className="hover:text-[#1a1a17]">Data Policy</Link>
            </span>
          </div>
        </div>
      </footer>

      {/* return-to-product pill — keeps a detouring buyer on their journey */}
      {returnTo && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <Link
            href={returnTo.href}
            className="group flex items-center gap-2 rounded-full bg-[#1a1a17] px-6 py-3 text-sm font-medium text-[#F4F1E8] shadow-xl"
          >
            Continue exploring {returnTo.name}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}

      {/* JSON-LD: the lab as an Organization, its products as offers */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "VERIDIAN COGNITIVE AI OS",
            legalName: "SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED",
            url: "https://veridian-ai-os.vercel.app",
            logo: "https://veridian-ai-os.vercel.app/logo-mark.svg",
            description:
              "AI cognitive research that becomes advanced, working products — operating systems that perceive a company's state, decide, act, and account for every action.",
            brand: PRODUCTS.map((p) => ({ "@type": "Brand", name: p.name })),
          }),
        }}
      />

      <VisitorIntelligence page="/" productKey="cognitive" />
    </main>
  );
}
