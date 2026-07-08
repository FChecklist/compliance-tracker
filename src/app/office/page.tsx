"use client";

// VERIDIAN AI — public landing page.
//
// Positioning (deliberate): people buy solutions to pain, so the page sells
// in this order — (1) the pain every buyer persona feels (owner / department
// head / team member: unending deadlines, missed to-dos, "any update?" on
// loop), (2) the rescue: ONE complete, SAP-class system of 50+ modules run
// end-to-end by your own AI assistant, shown as a premium animated ORBIT
// (one brain, fifty arms) — never an ERP-style module grid, (3) the maths:
// 10x productivity, save at least 2x what you spend.
//
// SOCIAL-PROOF NOTE FOR THE OWNER: the testimonials (STORIES) are
// ILLUSTRATIVE PLACEHOLDERS written by role/industry, not verified named
// customers. Swap them for real quotes as they come in — publishing
// fabricated reviews on a live paid page is a misleading-advertising risk
// (India CCPA fake-review rules / ASCI). Pricing numbers in PRICING are
// placeholders too — set your real prices there. The "50+ modules" claim is
// real (finance/ERP, CRM, HR, PMS, GRC, CLM, DMS… shipped in this repo).

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  Wallet,
  Star,
  Quote,
  AlarmClock,
  MessageSquareWarning,
  Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductSalesSection } from "@/components/ProductSalesSection";
import { VisitorIntelligence } from "@/components/VisitorIntelligence";
import { LegalBar } from "@/components/LegalBar";
import { RealProductDemo } from "@/components/RealProductDemo";

// --- Editable content -------------------------------------------------------

const STATS = [
  { value: "50+", label: "modules in one system" },
  { value: "10×", label: "productivity per person" },
  { value: "2×", label: "minimum return on cost" },
  { value: "24×7", label: "your AI never sleeps" },
];

// Pain, per buyer persona — each card sells to a different reader.
const PAINS = [
  {
    icon: AlarmClock,
    persona: "You — the owner",
    hook: "You built the company. Now it runs you.",
    pains: [
      "You pay for 10 tools — and still run the business on WhatsApp and Excel",
      "Nobody tells you about a problem until it has already cost money",
      "Every step of growth means more hires, more salaries, more chaos",
    ],
    flip: "One living picture of your whole business — and an AI that acts before small problems become expensive ones.",
  },
  {
    icon: Repeat,
    persona: "Your department heads",
    hook: "The day disappears in follow-ups.",
    pains: [
      "“Any update?” on repeat — chasing people instead of leading them",
      "Deadlines slip because a task sat unseen in someone's inbox",
      "A simple report takes two days to stitch from five systems",
    ],
    flip: "VERIDIAN chases, reminds, escalates and reports on its own — your managers lead, the AI follows up.",
  },
  {
    icon: MessageSquareWarning,
    persona: "Your team",
    hook: "Multi-tasking until something slips.",
    pains: [
      "Six screens open, the same data typed into three of them",
      "To-dos scattered across mail, chat and memory — one always escapes",
      "Busywork eats the hours the real work needed",
    ],
    flip: "Every employee gets a personal assistant that does the boring 80% — on time, error-free, without being reminded.",
  },
];

// Orbit rings — departments (inner) and headline modules (outer).
const ORBIT_DEPTS = ["Finance", "Sales & CRM", "HR & Payroll", "Operations", "Compliance", "Projects"];
const ORBIT_MODULES = [
  "Invoicing & GST",
  "Accounting",
  "Inventory",
  "Procurement",
  "Payroll",
  "Recruitment",
  "Leads & Pipeline",
  "Support Desk",
  "Contracts",
  "Documents",
  "Meetings & MoM",
  "Audit & Risk",
];

// The full breadth, grouped — 36 named here, honestly "50+" in the product.
const MODULE_MAP = [
  { dept: "Finance", items: ["Accounting", "Invoicing & GST", "Budgeting", "TDS & e-Invoicing", "Multi-currency", "Period Closing"] },
  { dept: "Sales & CRM", items: ["Leads", "Pipeline", "Quotes", "Follow-ups", "Customer 360", "Support & SLA"] },
  { dept: "HR & Payroll", items: ["Recruitment", "Onboarding", "Leave", "Payroll · PF · ESI", "Appraisals", "POSH"] },
  { dept: "Operations", items: ["Inventory", "Procurement", "Orders & Dispatch", "Vendors", "Returns", "Replenishment"] },
  { dept: "Compliance & Legal", items: ["Filings & Deadlines", "Notices", "Contracts", "Litigation", "Audit", "Risk Register"] },
  { dept: "Projects & Work", items: ["Tasks & To-dos", "Projects & Sprints", "Meetings & MoM", "Documents", "Team Chat", "Approvals"] },
];

const ASK_EXAMPLES = [
  "Raise this month's GST invoices and send them for approval",
  "Chase the 3 overdue payments and log what they say",
  "Onboard the new hire — offer letter, PF, and payroll",
  "Summarise yesterday's sales calls and update the pipeline",
];

const WOW = [
  {
    title: "A ₹50-lakh system. Without the ₹50 lakh.",
    line: "The depth large corporates buy from SAP or Oracle — 50+ modules across finance, sales, HR, operations and compliance — without the consultants, the training, or the two-year rollout.",
  },
  {
    title: "A worker for every employee",
    line: "Not one shared chatbot. Each person gets their own assistant that knows their job and does it.",
  },
  {
    title: "It runs the system — you don't",
    line: "Old software gives you screens to fill. VERIDIAN does the work across every department, then shows you what it did for your approval.",
  },
  {
    title: "Guardrails built in",
    line: "Nothing risky happens without a human yes. Every action is logged. Your data stays yours.",
  },
];

// Illustrative — replace with real, attributable quotes when available.
const STORIES = [
  {
    quote:
      "I used to end every day with 30 unanswered follow-ups. Now I end it approving finished work. That's the whole difference.",
    who: "Founder",
    org: "D2C brand, Bengaluru",
  },
  {
    quote:
      "We shut down four subscriptions. Finance, sales, HR — one place, one truth, and nobody chases spreadsheets any more.",
    who: "Finance Head",
    org: "Mid-size manufacturer, Pune",
  },
  {
    quote:
      "It feels like we bought an SAP-class system, except a person runs it for us. Every salesperson now has a back-office.",
    who: "Sales Director",
    org: "IT services firm, Gurugram",
  },
];

// --- Sections ---------------------------------------------------------------

function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#pain", label: "The problem" },
    { href: "#modules", label: "50+ modules" },
    { href: "#how", label: "How it works" },
    { href: "#cost", label: "Cost" },
    { href: "#sales", label: "Sales & demo" },
    { href: "/?from=office", label: "Research" },
  ];
  return (
    <nav className="sticky top-0 z-50 bg-ct-cream/80 backdrop-blur-md border-b border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/office" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ct-navy text-white">
            <Sparkles className="size-4 text-ct-saffron" />
          </span>
          <span className="font-heading text-lg text-ct-navy tracking-tight">
            VERIDIAN <span className="text-ct-saffron">OFFICE</span>
          </span>
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
              Start free
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
              <Button className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white">Start free</Button>
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

      {/* Two-column hero (2026-07-06): the live agent window sits BESIDE the
          headline so the product-is-the-advertisement plays above the fold —
          a visitor watches VERIDIAN working before they scroll a pixel. The
          earlier stacked layout hid it below the fold, and the first screen
          read as unchanged marketing copy. */}
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-14 md:pt-16 md:pb-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* the message */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-ct-border bg-white/70 px-4 py-1.5 text-xs font-medium text-ct-slate">
              <span className="size-1.5 rounded-full bg-ct-teal" />
              50+ modules · One SAP-class system · Run by your AI
            </div>

            <h1 className="mt-6 font-heading text-4xl leading-[1.08] text-ct-navy sm:text-5xl xl:text-6xl">
              Tell it what to do.
              <br />
              <span className="text-ct-saffron">Consider it done.</span>
            </h1>

            <p className="mx-auto lg:mx-0 mt-5 max-w-xl text-lg text-ct-slate">
              Software needs your time — screens to fill, boxes to tick, data entry that eats the hours your real
              work needed. VERIDIAN flips that: a complete AI Operating System —{" "}
              <span className="font-semibold text-ct-navy">50+ modules, end to end</span> — that does the working, so
              you spend your time on decisions, not on doing the software&apos;s job.
            </p>
            <p className="mx-auto lg:mx-0 mt-3 max-w-xl text-sm font-medium text-ct-teal">
              It doesn&apos;t replace your people — it makes every one of them 10× more productive, and the work
              easier and happier.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/signup">
                <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 text-base text-white shadow-saffron">
                  Open your account <ArrowRight className="ml-1 size-4" />
                </Button>
              </Link>
              <a href="#modules">
                <Button variant="outline" className="h-12 rounded-full px-7 text-base border-ct-border text-ct-navy">
                  See the 50+ modules
                </Button>
              </a>
            </div>
            <p className="mt-4 text-sm text-ct-muted">No credit card · Live in 2 minutes · built for decisions, not data entry</p>
          </div>

          {/* the proof — the real product, working, above the fold */}
          <div>
            <RealProductDemo />
          </div>
        </div>
      </div>
    </section>
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
        <div className="font-heading text-xl text-ct-muted italic">It&apos;s 11:40 PM. You&apos;re still typing &ldquo;any update?&rdquo;</div>
        <h2 className="mt-3 font-heading text-3xl md:text-4xl text-ct-navy">
          Unending deadlines. Missed to-dos.
          <br className="hidden sm:block" /> Follow-ups that never end.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          The real cost of running a business isn&apos;t the software bill. It&apos;s the chaos — and everyone in the
          company pays it differently.
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

// Positions n chips evenly on a circle of radius r (% of container), starting
// at 12 o'clock. Percent-based so the same maths works at every screen size.
// toFixed keeps the SSR and client strings byte-identical — raw float trig
// serialises differently on each side and trips React hydration.
function ringPos(i: number, n: number, r: number) {
  const a = (i / n) * 2 * Math.PI - Math.PI / 2;
  return { left: `${(50 + r * Math.cos(a)).toFixed(3)}%`, top: `${(50 + r * Math.sin(a)).toFixed(3)}%` };
}

function ModulesOrbit() {
  return (
    <section id="modules" className="bg-white border-y border-ct-border/60 overflow-hidden">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">
            One brain. <span className="text-ct-saffron">Fifty arms.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
            Everything a large corporate buys in an SAP-class platform — 50+ modules across every department — with one
            difference: yours comes with someone to run it. Your AI assistant, VERIDIAN.
          </p>
        </div>

        {/* the orbit */}
        <div className="relative mx-auto mt-14 aspect-square w-full max-w-[620px]">
          {/* guide rings */}
          <div className="absolute inset-[8%] rounded-full border border-dashed border-ct-border/70" />
          <div className="absolute inset-[27%] rounded-full border border-dashed border-ct-border/70" />

          {/* outer ring — modules (invisible on very small screens; list below
              covers them). NOTE: `invisible` (visibility) not `hidden`
              (display) — display:none pauses CSS animations, so a chip
              revealed later by a resize would restart its counter-rotation
              out of phase with the ring and render tilted. visibility keeps
              every animation ticking from page load, phases stay locked. */}
          <div className="absolute inset-0 animate-vd-orbit">
            {ORBIT_MODULES.map((m, i) => (
              <div key={m} className="absolute -translate-x-1/2 -translate-y-1/2 invisible sm:visible" style={ringPos(i, ORBIT_MODULES.length, 42)}>
                <div className="animate-vd-orbit-rev whitespace-nowrap rounded-full border border-ct-border bg-white px-3 py-1.5 text-xs font-medium text-ct-slate shadow-card">
                  {m}
                </div>
              </div>
            ))}
          </div>

          {/* inner ring — departments (counter-rotates for depth). Rendered
              once per breakpoint at different radii: mobile needs the chips
              further out (34%) to clear the core; desktop sits them at 28%. */}
          <div className="absolute inset-0 animate-vd-orbit-rev">
            {ORBIT_DEPTS.map((d, i) => (
              <div key={`m-${d}`} className="absolute -translate-x-1/2 -translate-y-1/2 visible sm:invisible" style={ringPos(i, ORBIT_DEPTS.length, 34)}>
                <div className="animate-vd-orbit whitespace-nowrap rounded-full bg-ct-navy px-2.5 py-1 text-[10px] font-semibold text-white shadow-card">
                  {d}
                </div>
              </div>
            ))}
            {ORBIT_DEPTS.map((d, i) => (
              <div key={`d-${d}`} className="absolute -translate-x-1/2 -translate-y-1/2 invisible sm:visible" style={ringPos(i, ORBIT_DEPTS.length, 28)}>
                <div className="animate-vd-orbit whitespace-nowrap rounded-full bg-ct-navy px-3 py-1.5 text-xs font-semibold text-white shadow-card">
                  {d}
                </div>
              </div>
            ))}
          </div>

          {/* the core */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="grid size-20 sm:size-40 place-items-center rounded-full bg-ct-navy text-center shadow-[0_0_80px_rgba(245,130,10,0.35)]">
              <div>
                <Sparkles className="mx-auto size-4 sm:size-6 text-ct-saffron" />
                <div className="mt-0.5 sm:mt-1 font-heading text-white text-[11px] sm:text-base leading-tight">VERIDIAN AI</div>
                <div className="text-[8px] sm:text-[10px] text-white/60">your assistant</div>
              </div>
            </div>
          </div>
        </div>

        {/* the full breadth, grouped */}
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULE_MAP.map((g) => (
            <div key={g.dept} className="rounded-2xl border border-ct-border bg-ct-cream p-5">
              <div className="text-sm font-semibold text-ct-navy">{g.dept}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.items.map((m) => (
                  <span key={m} className="rounded-md bg-white border border-ct-border px-2 py-1 text-xs text-ct-slate">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-ct-muted">
          …and more added every month. One login. One bill. One source of truth — nothing else to buy.
        </p>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    { n: "1", title: "Tell it", line: "Type or say what you want, the way you'd tell a colleague. No forms, no training." },
    { n: "2", title: "It works", line: "VERIDIAN runs the work across all 50+ modules — and shows you exactly what it did." },
    { n: "3", title: "You approve", line: "Anything that matters waits for your one-tap yes. You stay in control, always." },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Three steps. That&apos;s the whole thing.</h2>
      </div>
      <div className="mt-12 grid md:grid-cols-3 gap-6">
        {steps.map((s) => (
          <div key={s.n} className="relative rounded-2xl border border-ct-border p-7 bg-white">
            <div className="grid size-10 place-items-center rounded-xl bg-ct-navy font-heading text-lg text-white">
              {s.n}
            </div>
            <h3 className="mt-4 text-xl font-semibold text-ct-navy">{s.title}</h3>
            <p className="mt-2 text-ct-slate">{s.line}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl bg-ct-cloud p-7">
        <div className="text-sm font-semibold text-ct-muted">Things people ask it, every day</div>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {ASK_EXAMPLES.map((e) => (
            <div key={e} className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-ct-navy">
              <Sparkles className="size-4 shrink-0 text-ct-saffron" />
              &ldquo;{e}&rdquo;
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Wow() {
  return (
    <section className="bg-ct-navy text-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <h2 className="font-heading text-3xl md:text-4xl">Enterprise power. Zero enterprise pain.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/70">
            This isn&apos;t a chatbot bolted onto old software. It&apos;s the whole system — run by a worker that
            actually works for you.
          </p>
        </div>
        <div className="mt-12 grid md:grid-cols-2 gap-5">
          {WOW.map((w) => (
            <div key={w.title} className="rounded-2xl border border-white/10 bg-white/5 p-7">
              <Sparkles className="size-5 text-ct-saffron" />
              <h3 className="mt-3 text-xl font-semibold">{w.title}</h3>
              <p className="mt-2 text-white/70">{w.line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Roi() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="rounded-3xl border border-ct-border bg-gradient-to-br from-white to-ct-cloud p-10 md:p-14 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-ct-teal/10 px-4 py-1.5 text-sm font-medium text-ct-teal">
          <Wallet className="size-4" /> The maths that makes it easy
        </div>
        <h2 className="mt-5 font-heading text-3xl md:text-5xl text-ct-navy">
          <span className="text-ct-saffron">10×</span> the output. <span className="text-ct-saffron">2×</span> the savings.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-ct-slate">
          One VERIDIAN seat replaces a stack of subscriptions and hours of manual work. Teams do 10× more, make almost
          no routine errors, and save at least 2× what they spend — usually far more. The power of a corporate ERP, at
          a price that pays for itself in the first week.
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          {[
            ["10×", "more done per person"],
            ["2×", "minimum return on every rupee"],
            ["50+", "modules on one bill"],
          ].map(([v, l]) => (
            <div key={l} className="rounded-2xl bg-white border border-ct-border py-5">
              <div className="font-heading text-3xl text-ct-navy">{v}</div>
              <div className="mt-1 text-sm text-ct-muted">{l}</div>
            </div>
          ))}
        </div>
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
          <h2 className="mt-4 font-heading text-3xl md:text-4xl text-ct-navy">Teams that got their evenings back</h2>
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

function CostCta() {
  return (
    <section id="cost" className="mx-auto max-w-4xl px-5 py-20 text-center">
      <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">We discuss cost. We don&apos;t publish price lists.</h2>
      <p className="mx-auto mt-4 max-w-xl text-ct-slate">
        What you pay should track what VERIDIAN actually does for you — not a seat count picked off a page. Tell us
        about your team and we&apos;ll work out a number that pays for itself.
      </p>
      <Link href="/contact">
        <Button className="mt-7 h-12 rounded-full bg-ct-navy hover:bg-ct-navy/90 px-8 text-base text-white">
          Talk to us about cost
        </Button>
      </Link>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24">
      <div className="rounded-3xl bg-ct-navy px-8 py-16 text-center text-white">
        <ShieldCheck className="mx-auto size-8 text-ct-saffron" />
        <h2 className="mt-4 font-heading text-3xl md:text-5xl">Get your evenings back.</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">
          One complete system. 50+ modules. An assistant for every employee. The deadlines get met, the follow-ups get
          done — and you approve the results. It takes two minutes to start.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
          <Link href="/signup">
            <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-8 text-base text-white shadow-saffron">
              Open your account <ArrowRight className="ml-1 size-4" />
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
            <Sparkles className="size-3.5 text-ct-saffron" />
          </span>
          <span className="font-heading text-ct-navy">VERIDIAN</span>
          <span className="text-sm text-ct-muted">— your complete office, run by AI</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-ct-muted">
          <a href="#modules" className="hover:text-ct-navy">50+ modules</a>
          <a href="#cost" className="hover:text-ct-navy">Cost</a>
          <Link href="/login" className="hover:text-ct-navy">Log in</Link>
        </div>
        <div className="text-sm text-ct-muted">© {new Date().getFullYear()} VERIDIAN AI</div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-ct-cream text-ct-navy antialiased">
      <Nav />
      <Hero />
      <StatBand />
      <Pain />
      <ModulesOrbit />
      <How />
      <Wow />
      <Roi />
      <Stories />
      <CostCta />
      <ProductSalesSection product="VERIDIAN OFFICE AI OS" />
      <FinalCta />
      <Footer />
      <LegalBar />
      <VisitorIntelligence page="/office" productKey="office" />
    </main>
  );
}
