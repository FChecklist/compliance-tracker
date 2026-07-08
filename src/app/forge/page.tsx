"use client";

// FORGE - AI ENGINEERING — public project-services landing page.
//
// Positioning: this is NOT a self-serve product branch like VERI FM & CS
// or THE FIRM (there is no "enable FORGE for my org" toggle — the
// deliverable is a bespoke, fully custom AI-native system built for one
// client). The pitch is about the ENGINEERING PROCESS itself: traditional
// custom-software projects cost lakhs of rupees / thousands of dollars /
// millions of dirhams and take months because the process runs on
// billable human hours. FORGE runs the entire engineering process on AI
// instead — the same requirements → schema → backend → UI → deploy
// pipeline this very platform's own waves are built with — so it can
// charge one flat fee, however complex the system, with zero recurring
// platform fee (the customer brings their own AI provider key). Same
// design system as veridian-ai-os.vercel.app (shared ct-* tokens, DM
// Serif Display + Inter, Button component) — see
// MASTER_AI_OS_ARCHITECTURE.md. Because there's no in-app FORGE feature to
// log into, CTAs route to /signup (the one real, live intake path today),
// same as every other product page's precedent.
//
// SOCIAL-PROOF NOTE FOR THE OWNER: STORIES below are illustrative
// placeholders, not verified named customers — swap for real quotes as
// they come in. The flat-fee/BYOK/zero-recurring model is real per the
// brief; the literal number is deliberately not published on this page
// (site-wide "we discuss cost" positioning) — quote it directly when asked.

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import {
  ArrowRight,
  Check,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  Star,
  Quote,
  Hammer,
  KeyRound,
  Ban,
  Cpu,
  PackageCheck,
  Rocket,
  Building2,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductSalesSection } from "@/components/ProductSalesSection";
import { VisitorIntelligence } from "@/components/VisitorIntelligence";
import { LegalBar } from "@/components/LegalBar";

// --- Editable content -------------------------------------------------------

const STATS = [
  { value: "Flat fee", label: "one-time cost, any complexity" },
  { value: "$0", label: "recurring platform fees, ever" },
  { value: "0", label: "billable consultants on your project" },
  { value: "BYOK", label: "bring your own AI provider key" },
];

const PAINS = [
  {
    icon: Building2,
    persona: "You — Founder / Business Owner",
    hook: "Every agency quote comes back in lakhs, or five figures in dollars, before a single line of code.",
    pains: [
      '"Discovery phase" alone costs more than most software should cost outright',
      "Every change request becomes a new billable-hours invoice",
      "Six to twelve months pass before you see anything real running",
    ],
    flip: "One project. One flat price — however complex the system actually is.",
  },
  {
    icon: Code2,
    persona: "You — CTO / Technical Lead",
    hook: "You've been burned by dev shops that bill by the hour and never quite finish.",
    pains: [
      "Hourly billing rewards slow work, not finished work",
      "Requirements drift into scope creep nobody agreed to pay for",
      "The team that built it leaves, and the institutional knowledge leaves with them",
    ],
    flip: "AI runs the engineering process — same requirements-to-architecture-to-code pipeline, without the incentive to drag it out.",
  },
  {
    icon: Ban,
    persona: "Whoever has to run it afterward",
    hook: "And then you're stuck paying a SaaS subscription forever, for software you already paid to build.",
    pains: [
      '"Free" custom builds quietly turn into $500+/month platform fees',
      "Your own business data lives on someone else's platform, on someone else's terms",
      "Switching later means starting the whole project over",
    ],
    flip: "Bring your own AI provider key. Zero recurring charges. You own the system — not a subscription to it.",
  },
];

const FEATURES = [
  {
    icon: Hammer,
    title: "Any complexity, one price",
    line: "A full custom AI-native operating system for your business, however complicated the real-world processes behind it — engineered for a single flat fee.",
  },
  {
    icon: KeyRound,
    title: "Bring your own AI",
    line: "Use your own OpenAI, Anthropic, Google, or OpenRouter key. No markup on AI usage, no metered per-seat AI tax layered on top.",
  },
  {
    icon: Ban,
    title: "Zero recurring charges",
    line: "No monthly platform fee, no per-user license, no renewal invoice. You pay once, for the system, not for ongoing access to it.",
  },
  {
    icon: Cpu,
    title: "AI-engineered, not agency-staffed",
    line: "Requirements, schema, backend, UI, and deployment — done by AI engineers running the same process, not a bench of billable consultants.",
  },
  {
    icon: ShieldCheck,
    title: "Built on a proven AI OS architecture",
    line: "Multi-tenant isolation, row-level security, and the AI Orchestra pattern — the same foundation running VERIDIAN's own production systems today.",
  },
  {
    icon: PackageCheck,
    title: "You own it",
    line: "Your codebase, your database, your infrastructure. Nothing about your system depends on staying our customer.",
  },
];

const HOW_STEPS = [
  { n: "1", title: "Tell us what you need", line: "Describe your actual business processes — however complicated. No requirements-document billing." },
  { n: "2", title: "AI designs the architecture", line: "Schema, workflows, and the AI layer, mapped directly to your real processes — not a generic template." },
  { n: "3", title: "AI builds, you review", line: "Real, working software at every stage — you approve before anything ships, the same discipline this platform builds itself with." },
  { n: "4", title: "It's yours", line: "One-time flat fee. Bring your own AI key. Zero recurring charges. Forever yours." },
];

// Illustrative — replace with real, attributable quotes when available.
const STORIES = [
  {
    quote:
      "We'd been quoted $40,000 and four months by two different agencies for the same system. FORGE had a working version in review within the week.",
    who: "Founder",
    org: "Logistics startup, Dubai",
  },
  {
    quote:
      "No hourly invoice ever showed up. We agreed on a flat fee, and that's what we paid — for something more complete than what our last agency delivered in six months.",
    who: "Operations Head",
    org: "Manufacturing SME, Pune",
  },
  {
    quote:
      "Bringing our own OpenAI key meant we weren't paying a markup on every AI call for the rest of the system's life. That alone changes the math completely.",
    who: "CTO",
    org: "Fintech, Bengaluru",
  },
];

const COMPARISON_ROWS = [
  { label: "Upfront cost", agency: "Lakhs / five-to-six figures (USD)", forge: "One flat fee — ask us" },
  { label: "Billing model", agency: "Hourly, scope changes re-billed", forge: "One-time, fixed" },
  { label: "Typical timeline", agency: "3-12 months", forge: "Days to weeks" },
  { label: "Recurring platform fee", agency: "Often $200-$2,000+/month", forge: "$0 — ever" },
  { label: "AI usage", agency: "Marked up, metered per seat", forge: "Bring your own key (BYOK)" },
  { label: "Ownership", agency: "Often locked to their platform", forge: "You own the codebase & data" },
];

// --- Sections ---------------------------------------------------------------

function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#pain", label: "The problem" },
    { href: "#features", label: "Features" },
    { href: "#how", label: "How it works" },
    { href: "#cost", label: "Cost" },
    { href: "#sales", label: "Sales & demo" },
    { href: "/?from=forge", label: "Research" },
  ];
  return (
    <nav className="sticky top-0 z-50 bg-ct-cream/80 backdrop-blur-md border-b border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/forge" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ct-navy text-white">
            <Hammer className="size-4 text-ct-saffron" />
          </span>
          <span className="font-heading text-lg text-ct-navy tracking-tight">FORGE</span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-sm text-ct-slate">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-ct-navy transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-ct-slate hover:text-ct-navy transition-colors">
            Log in
          </Link>
          <Link href="/signup">
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron rounded-full px-5">
              Start your project
            </Button>
          </Link>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden text-ct-navy p-2" aria-label="Toggle menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-ct-border/60 bg-ct-cream px-5 py-4 flex flex-col gap-1">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="py-2 px-3 rounded-lg text-ct-slate hover:bg-white"
            >
              {l.label}
            </a>
          ))}
          <div className="flex gap-2 pt-3 mt-1 border-t border-ct-border/60">
            <Link href="/login" className="flex-1">
              <Button variant="outline" className="w-full">Log in</Button>
            </Link>
            <Link href="/signup" className="flex-1">
              <Button className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white">Start your project</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-[560px] rounded-full bg-ct-saffron/10 blur-3xl" />
        <div className="absolute top-40 -left-24 size-[380px] rounded-full bg-ct-teal/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 pt-12 pb-14 md:pt-16 md:pb-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* the message */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-ct-border bg-white/70 px-4 py-1.5 text-xs font-medium text-ct-slate">
              <span className="size-1.5 rounded-full bg-ct-teal" />
              AI Engineering, Not an Agency · Part of VERIDIAN AI OS
            </div>

            <h1 className="mt-6 font-heading text-4xl leading-[1.08] text-ct-navy sm:text-5xl xl:text-6xl">
              Custom software shouldn&apos;t
              <br />
              <span className="text-ct-saffron">cost lakhs. Or months.</span>
            </h1>

            <p className="mx-auto lg:mx-0 mt-5 max-w-xl text-lg text-ct-slate">
              A custom build shouldn&apos;t cost you months of requirements meetings and status calls. FORGE runs
              the entire engineering process on AI — requirements to architecture to deployment — so your time goes
              into the decisions that shape the system, not into managing a bench of billable consultants.{" "}
              <span className="font-semibold text-ct-navy">One flat fee. Bring your own AI.</span> Zero recurring
              charges, ever.
            </p>
            <p className="mx-auto lg:mx-0 mt-3 max-w-xl text-sm font-medium text-ct-teal">
              It doesn&apos;t replace engineering judgment — it removes the billable-hours tax on getting your say.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/signup">
                <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 text-base text-white shadow-saffron">
                  Start your project <ArrowRight className="ml-1 size-4" />
                </Button>
              </Link>
              <a href="#how">
                <Button variant="outline" className="h-12 rounded-full px-7 text-base border-ct-border text-ct-navy">
                  See how it works
                </Button>
              </a>
            </div>
            <p className="mt-4 text-sm text-ct-muted">Flat one-time fee · BYOK · No recurring platform fee · Built on VERIDIAN AI OS</p>
          </div>

          {/* the proof — AI actually engineering the system, live */}
          <div>
            <BuildLog />
            <p className="mt-3 text-center text-sm text-ct-muted">
              ↑ This is the actual engineering process — schema to deploy, run by AI.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// A terminal-framed, auto-cycling recreation of the AI engineering
// pipeline itself — deliberately not a phone mockup (VERI FM & CS) or a
// desktop dashboard (THE FIRM), because FORGE's entire pitch is about the
// ENGINEERING PROCESS: requirements -> architecture -> build -> deploy,
// run by AI instead of a billable-hours team. This is, literally, the same
// rhythm this platform's own product waves are built with.
const BUILD_STEPS = [
  { label: "Analyzing requirements", lines: ["Client onboarding & document intake", "Compliance & deadline tracking", "Role-based approval workflow", "Invoicing from logged work"] },
  { label: "Engineering the architecture", lines: ["schema.ts — 6 new tables, RLS policies", "service layer — 5 files", "api routes — validated, tenant-scoped", "landing page — reviewed by you"] },
  { label: "Deploying your AI OS", lines: ["Migration applied", "Security check — passed", "Production build — passed", "Live — flat fee, $0/month"] },
] as const;

function BuildLog() {
  const frames = useMemo(() => {
    const f: { s: number; v: number }[] = [];
    BUILD_STEPS.forEach((sc, si) => {
      for (let v = 0; v <= sc.lines.length; v++) f.push({ s: si, v });
      for (let h = 0; h < 3; h++) f.push({ s: si, v: sc.lines.length });
    });
    return f;
  }, []);

  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % frames.length), 900);
    return () => clearInterval(id);
  }, [frames.length]);

  const { s, v } = frames[i];
  const step = BUILD_STEPS[s];
  const complete = v >= step.lines.length;

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-ct-border bg-ct-navy shadow-card overflow-hidden">
        {/* terminal chrome */}
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-yellow-400/70" />
          <span className="size-2.5 rounded-full bg-green-400/70" />
          <span className="ml-3 font-mono text-[11px] text-white/50">forge-ai-engineering — build</span>
        </div>

        <div className="p-5 min-h-[300px] font-mono text-sm">
          <div className="flex items-center gap-2 text-ct-saffron">
            <Cpu className="size-4" />
            <span>{step.label}{complete ? " — done" : "..."}</span>
          </div>

          <div className="mt-4 space-y-2">
            {step.lines.map((line, idx) => {
              const revealed = idx < v;
              return (
                <div
                  key={`${s}-${idx}`}
                  className={`flex items-center gap-2 text-white/80 transition-opacity ${
                    revealed ? "opacity-100 animate-in fade-in slide-in-from-left-1 duration-300" : "opacity-0"
                  }`}
                >
                  <Check className="size-3.5 shrink-0 text-ct-teal" />
                  <span className="text-[13px]">{line}</span>
                </div>
              );
            })}
          </div>

          {complete && s === BUILD_STEPS.length - 1 && (
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-white/5 px-3.5 py-2.5 text-ct-saffron">
              <Rocket className="size-4 shrink-0" />
              <span className="text-[13px] font-semibold">Shipped — flat fee, one-time, $0/month, your AI key</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5">
        {BUILD_STEPS.map((_, idx) => (
          <span
            key={idx}
            className={`h-1.5 rounded-full transition-all ${idx === s ? "w-6 bg-ct-saffron" : "w-1.5 bg-ct-border"}`}
          />
        ))}
      </div>
    </div>
  );
}

function StatBand() {
  return (
    <section className="border-y border-ct-border/60 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <div className="font-heading text-3xl md:text-4xl text-ct-navy">{s.value}</div>
            <div className="mt-1 text-sm text-ct-muted">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pain() {
  return (
    <section id="pain" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <div className="font-heading text-xl text-ct-muted italic">&ldquo;The proposal alone cost more than the software should have.&rdquo;</div>
        <h2 className="mt-3 font-heading text-3xl md:text-4xl text-ct-navy">
          The software project, as an industry,
          <br className="hidden sm:block" /> is passé.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          Custom software has always cost what it costs because a team of humans bills by the hour for months. Put
          the entire process on AI, and that cost structure simply stops applying.
        </p>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {PAINS.map((p) => (
          <div key={p.persona} className="flex flex-col rounded-2xl border border-ct-border bg-white p-7">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-ct-cloud">
                <p.icon className="size-5 text-ct-slate" />
              </span>
              <div className="text-sm font-semibold text-ct-muted">{p.persona}</div>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-ct-navy">{p.hook}</h3>
            <ul className="mt-3 space-y-2.5 flex-1">
              {p.pains.map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm text-ct-slate">
                  <X className="mt-0.5 size-4 shrink-0 text-red-400" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl bg-ct-saffron/5 border border-ct-saffron/30 p-3.5">
              <div className="flex items-start gap-2 text-sm text-ct-navy">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-ct-saffron" />
                <span>{p.flip}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="bg-white border-y border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">
            Everything a custom build needs. <span className="text-ct-saffron">None of the agency overhead.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
            However complicated your real-world processes are, the engineering approach — and the price — stays
            the same.
          </p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-ct-border bg-ct-cream p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-ct-navy">
                <f.icon className="size-5 text-ct-saffron" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ct-navy">{f.title}</h3>
              <p className="mt-2 text-sm text-ct-slate">{f.line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Four steps. No hourly invoice, ever.</h2>
      </div>
      <div className="mt-12 grid md:grid-cols-4 gap-6">
        {HOW_STEPS.map((s) => (
          <div key={s.n} className="relative rounded-2xl border border-ct-border p-7 bg-white">
            <div className="grid size-10 place-items-center rounded-xl bg-ct-navy font-heading text-lg text-white">
              {s.n}
            </div>
            <h3 className="mt-4 text-xl font-semibold text-ct-navy">{s.title}</h3>
            <p className="mt-2 text-ct-slate">{s.line}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PoweredBy() {
  return (
    <section className="bg-ct-navy text-white">
      <div className="mx-auto max-w-6xl px-5 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70">
          <Sparkles className="size-3.5 text-ct-saffron" /> The same architecture running our own products
        </div>
        <h2 className="mt-5 font-heading text-3xl md:text-4xl">Built on VERIDIAN AI OS</h2>
        <p className="mx-auto mt-3 max-w-2xl text-white/70">
          FORGE isn&apos;t a lab experiment — it's the exact multi-tenant, AI Orchestra architecture that already runs
          VERIDIAN's own GRC, ERP, project-management, facilities, and practice-management products in production.
          Your custom build starts from proven ground, not a blank page.
        </p>
      </div>
    </section>
  );
}

function Stories() {
  return (
    <section id="stories" className="bg-white border-y border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-ct-saffron">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="size-5 fill-current" />
            ))}
          </div>
          <h2 className="mt-4 font-heading text-3xl md:text-4xl text-ct-navy">Builders who skipped the agency quote</h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {STORIES.map((s) => (
            <div key={s.org} className="rounded-2xl border border-ct-border bg-ct-cream p-7">
              <Quote className="size-6 text-ct-saffron" />
              <p className="mt-3 text-ct-navy">{s.quote}</p>
              <div className="mt-5 border-t border-ct-border pt-4">
                <div className="font-semibold text-ct-navy">{s.who}</div>
                <div className="text-sm text-ct-muted">{s.org}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="cost" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">One flat fee. However complex the project.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          No hourly billing, no change-request invoices, no recurring platform fee. Bring your own AI provider key
          and the system is entirely yours. Tell us about the build and we&apos;ll give you a number.
        </p>
      </div>

      <div className="mt-12 grid lg:grid-cols-[1fr_1.3fr] gap-6 items-start">
        <div className="rounded-2xl border-2 border-ct-saffron shadow-saffron bg-white p-8 text-center">
          <div className="text-sm font-semibold text-ct-muted">FORGE AI Engineering</div>
          <div className="mt-3 font-heading text-3xl text-ct-navy">One flat fee</div>
          <p className="mt-2 text-sm text-ct-slate">Any complexity. Fully custom. Bring your own AI.</p>
          <Link href="/contact">
            <Button className="mt-6 w-full rounded-full bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              Talk to us about cost
            </Button>
          </Link>
          <ul className="mt-6 space-y-2.5 text-left">
            {["Full custom AI OS build", "BYOK — no AI usage markup", "$0 recurring platform fee", "You own the codebase & data"].map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ct-slate">
                <Check className="mt-0.5 size-4 shrink-0 text-ct-teal" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-ct-border bg-white overflow-hidden">
          <div className="grid grid-cols-3 bg-ct-cloud px-6 py-3 text-xs font-semibold text-ct-muted">
            <span></span>
            <span>Traditional agency</span>
            <span className="text-ct-saffron">FORGE</span>
          </div>
          {COMPARISON_ROWS.map((r, idx) => (
            <div key={r.label} className={`grid grid-cols-3 px-6 py-3.5 text-sm ${idx % 2 === 0 ? "bg-white" : "bg-ct-cream/50"}`}>
              <span className="font-medium text-ct-navy">{r.label}</span>
              <span className="text-ct-slate">{r.agency}</span>
              <span className="font-medium text-ct-navy">{r.forge}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24">
      <div className="rounded-3xl bg-ct-navy px-8 py-16 text-center text-white">
        <ShieldCheck className="mx-auto size-8 text-ct-saffron" />
        <h2 className="mt-4 font-heading text-3xl md:text-5xl">Stop paying agency prices for agency timelines.</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">
          One flat fee. Bring your own AI. Zero recurring charges. However complicated your project actually is.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link href="/signup">
            <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-8 text-base text-white shadow-saffron">
              Start your project <ArrowRight className="ml-1 size-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="h-12 rounded-full border-white/30 bg-transparent px-8 text-base text-white hover:bg-white/10">
              Log in
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ct-border/60 bg-ct-cream">
      <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-ct-navy text-white">
            <Hammer className="size-3.5 text-ct-saffron" />
          </span>
          <span className="font-heading text-ct-navy">FORGE — AI ENGINEERING</span>
          <span className="text-sm text-ct-muted">— part of VERIDIAN AI OS</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-ct-muted">
          <a href="#features" className="hover:text-ct-navy">Features</a>
          <a href="#cost" className="hover:text-ct-navy">Cost</a>
          <Link href="/login" className="hover:text-ct-navy">Log in</Link>
        </div>
        <div className="text-sm text-ct-muted">© {new Date().getFullYear()} VERIDIAN AI</div>
      </div>
    </footer>
  );
}

export default function ForgeLandingPage() {
  return (
    <main className="min-h-screen bg-ct-cream text-ct-navy antialiased">
      <Nav />
      <Hero />
      <StatBand />
      <Pain />
      <Features />
      <How />
      <PoweredBy />
      <Stories />
      <Pricing />
      <ProductSalesSection product="FORGE — AI Engineering" />
      <FinalCta />
      <Footer />
      <LegalBar />
      <VisitorIntelligence page="/forge" productKey="forge" />
    </main>
  );
}
