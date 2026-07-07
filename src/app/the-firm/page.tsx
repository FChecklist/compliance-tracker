"use client";

// THE FIRM AI OS — public product landing page.
//
// Positioning: this product is for the OWNER of a CA/CS/Legal/GRC/Audit
// firm (4-20 staff) who serves many client companies and individual
// taxpayees across some mix of those five service lines — a scaled-down
// Ernst & Young. Unlike VERI FM & CS (whose adoption angle is a single
// ground-staff task on a phone screen), the buyer here wants command-
// center visibility across staff AND clients — so the hero visual is a
// desktop "Practice Cockpit" (browser-chrome framed, like the parent
// site's own AgentWindow), not a phone mockup. Same design system as
// veridian-ai-os.vercel.app (shared ct-* tokens, DM Serif Display + Inter,
// Button component) — see MASTER_AI_OS_ARCHITECTURE.md.
//
// SOCIAL-PROOF NOTE FOR THE OWNER: STORIES below are illustrative
// placeholders, not verified named customers — swap for real quotes as
// they come in. PRICING numbers are placeholders too. The service-line
// count (5) and module list are real (shipped in this repo, Wave 108) —
// client/company names in the cockpit mockup are illustrative only.

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
  Briefcase,
  Scale,
  UserCheck,
  Clock,
  Receipt,
  FileWarning,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductSalesSection } from "@/components/ProductSalesSection";
import { VisitorIntelligence } from "@/components/VisitorIntelligence";
import { LegalBar } from "@/components/LegalBar";

// --- Editable content -------------------------------------------------------

const STATS = [
  { value: "5", label: "service lines, one client roster" },
  { value: "0", label: "spreadsheets to reconcile deadlines across" },
  { value: "1", label: "place to see who's overloaded" },
  { value: "1-click", label: "invoice from unbilled hours" },
];

const PAINS = [
  {
    icon: Briefcase,
    persona: "You — Firm Owner / Partner",
    hook: "You're the only one who knows which client is on scrutiny and who's free this week.",
    pains: [
      "Client status lives in your head, not in a system your team can see",
      "You find out a deadline was missed only after the client calls, upset",
      "You can't tell if you're about to lose a good associate to burnout",
    ],
    flip: "One client roster, one deadline radar, one staff-utilization view — the whole firm's status, at a glance.",
  },
  {
    icon: Users,
    persona: "Your managers & senior associates",
    hook: "You're juggling 15 clients across Excel trackers that don't talk to each other.",
    pains: [
      "A GST tracker, a litigation tracker, a filing calendar — none of them agree",
      "Handing off a client to a colleague means explaining everything from scratch",
      "You only see your own clients — no visibility into who else needs help",
    ],
    flip: "One engagement per client per service line, with its own deliverable checklist — assigned, tracked, done.",
  },
  {
    icon: FileWarning,
    persona: "Whoever has to answer the client",
    hook: "Clients ask \"what's the status of my notice?\" and you have to dig through email.",
    pains: [
      "Tax notices, assessment orders, and appeals live in a dozen different inboxes",
      "Nobody tracks the actual statute-barred date until it's almost too late",
      "Billing lags behind the work — hours get logged nowhere and never invoiced",
    ],
    flip: "Every tax case has its assessment year, forum, and limitation date tracked — linked straight to the notice.",
  },
];

const FEATURES = [
  {
    icon: Users,
    title: "Client roster & service-line scoping",
    line: "One roster for every client — companies and individual taxpayees alike. Toggle exactly which of CA, CS, Legal, GRC, or Audit services each one receives, and who leads it.",
  },
  {
    icon: Briefcase,
    title: "Engagements & deliverables",
    line: "Scope of work, fee arrangement, and a deliverable checklist per client per service line — linked straight to the compliance item, legal matter, or audit engagement it's actually about.",
  },
  {
    icon: Scale,
    title: "Indian tax-case workflow",
    line: "Assessment year, section code, appellate forum — AO, CIT(A), ITAT, High Court, Supreme Court — and the statute-barred limitation date, tracked separately from just a reminder date.",
  },
  {
    icon: UserCheck,
    title: "Staff assignment & capacity",
    line: "Assign partners, managers, associates, and staff to clients with allocated hours per week — then see actual logged hours against that allocation, per person, per week.",
  },
  {
    icon: Clock,
    title: "Time tracking",
    line: "Start a timer against a client and engagement, or log hours manually. Every entry is billable by default, editable until the moment it's invoiced.",
  },
  {
    icon: Receipt,
    title: "Billing",
    line: "Generate an invoice straight from unbilled hours — rates resolve per staff member, per client, automatically. A time entry can never be billed twice.",
  },
];

const SERVICE_LINES_SAMPLE = ["CA Services", "CS Services", "Legal Services", "GRC Services", "Audit Services"];

const HOW_STEPS = [
  { n: "1", title: "Add a client", line: "Company or individual taxpayee — either way, one record, one roster." },
  { n: "2", title: "Enable service lines & assign staff", line: "Toggle CA/CS/Legal/GRC/Audit per client, assign who owns it and at what capacity." },
  { n: "3", title: "Log engagements & time", line: "Scope the work, track deliverables, log hours as the team actually does the work." },
  { n: "4", title: "Invoice from unbilled hours", line: "Deadlines surface automatically from every module already tracking this client's work." },
];

// Illustrative — replace with real, attributable quotes when available.
const STORIES = [
  {
    quote:
      "I used to be the single point of failure for every client's status. Now my managers can see it themselves — and so can I, for the whole firm.",
    who: "Partner",
    org: "CA firm, Ahmedabad",
  },
  {
    quote:
      "We finally have one place that tracks the actual limitation date on a scrutiny case, not just a reminder someone set two years ago.",
    who: "Senior Associate",
    org: "CA & CS practice, Pune",
  },
  {
    quote:
      "Billing used to lag two months behind the work. Now it's a button — unbilled hours become an invoice the same afternoon.",
    who: "Practice Manager",
    org: "Legal & GRC firm, Bengaluru",
  },
];

// Placeholder pricing — set your real prices here. Priced per staff seat,
// since a firm owner thinks in "how many people on my team," not per client.
const PRICING = [
  {
    name: "Starter",
    price: "₹999",
    unit: "/ staff seat / month",
    tagline: "For a small practice getting its client roster and deadlines onto one system.",
    features: ["Up to 5 staff seats", "Client roster & service-line scoping", "Engagements & deliverables", "Email support"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Business",
    price: "₹1,499",
    unit: "/ staff seat / month",
    tagline: "The complete practice operation — tax-case workflow, capacity, and billing included.",
    features: [
      "Unlimited staff seats",
      "Indian tax-case workflow",
      "Staff assignment & capacity tracking",
      "Time tracking & billing from unbilled hours",
      "Priority support",
    ],
    cta: "Start free",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    tagline: "For multi-branch firms with security & integration needs.",
    features: ["Everything in Business", "SSO & advanced security", "Dedicated success manager", "Custom integrations"],
    cta: "Talk to us",
    highlight: false,
  },
];

// --- Sections ---------------------------------------------------------------

function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#pain", label: "The problem" },
    { href: "#features", label: "Features" },
    { href: "#how", label: "How it works" },
    { href: "#pricing", label: "Pricing" },
    { href: "#sales", label: "Sales & demo" },
    { href: "/?from=the-firm", label: "Research" },
  ];
  return (
    <nav className="sticky top-0 z-50 bg-ct-cream/80 backdrop-blur-md border-b border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/the-firm" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ct-navy text-white">
            <Briefcase className="size-4 text-ct-saffron" />
          </span>
          <span className="font-heading text-lg text-ct-navy tracking-tight">THE FIRM</span>
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

      <div className="mx-auto max-w-6xl px-5 pt-12 pb-14 md:pt-16 md:pb-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* the message */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-ct-border bg-white/70 px-4 py-1.5 text-xs font-medium text-ct-slate">
              <span className="size-1.5 rounded-full bg-ct-teal" />
              CA · CS · Legal · GRC · Audit · Part of VERIDIAN AI OS
            </div>

            <h1 className="mt-6 font-heading text-4xl leading-[1.08] text-ct-navy sm:text-5xl xl:text-6xl">
              Run your practice
              <br />
              <span className="text-ct-saffron">like the Big 4 do.</span>
            </h1>

            <p className="mx-auto lg:mx-0 mt-5 max-w-xl text-lg text-ct-slate">
              THE FIRM is the one system for a CA, CS, Legal, GRC, or Audit practice — every client, every service
              line, in one roster.{" "}
              <span className="font-semibold text-ct-navy">One deadline radar. One staff-utilization view.</span>{" "}
              Bill from unbilled hours in one click.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/signup">
                <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 text-base text-white shadow-saffron">
                  Set up your practice <ArrowRight className="ml-1 size-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button variant="outline" className="h-12 rounded-full px-7 text-base border-ct-border text-ct-navy">
                  See how it works
                </Button>
              </a>
            </div>
            <p className="mt-4 text-sm text-ct-muted">No credit card · Add your first client in 2 minutes · Built on VERIDIAN AI OS</p>
          </div>

          {/* the proof — the owner's own command center, working */}
          <div>
            <PracticeCockpit />
            <p className="mt-3 text-center text-sm text-ct-muted">
              ↑ Your whole practice — clients, deadlines, and staff — in one screen.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// A browser-chrome-framed, auto-cycling recreation of the owner's own
// command-center view — deliberately NOT a phone mockup (that's VERI FM &
// CS's adoption angle for ground staff). Here the buyer wants command-
// center visibility across staff AND clients, so the artifact is a desktop
// dashboard, mirroring the parent site's own AgentWindow rhythm (script →
// reveal → hold → next screen). Client/company names shown are
// illustrative, not real customers.
const ROSTER_ROWS = [
  { name: "Shah Textiles Pvt Ltd", lines: ["CA", "GST"], partner: "RM", due: "GST-3B · 3 days" },
  { name: "Verma & Sons LLP", lines: ["CS", "Legal"], partner: "AK", due: "Board meeting · 6 days" },
  { name: "Rohit Verma (Individual)", lines: ["CA"], partner: "RM", due: "ITR filing · 12 days" },
  { name: "Bright Textiles Ltd", lines: ["Audit", "GRC"], partner: "PS", due: "Statutory audit · 18 days" },
] as const;

const DEADLINE_ROWS = [
  { client: "Shah Textiles", label: "GST-3B return", type: "Compliance", days: 3 },
  { client: "Bright Textiles", label: "Limitation date — AY 2022-23 scrutiny", type: "Tax case", days: 9 },
  { client: "Verma & Sons", label: "Board meeting minutes", type: "Deliverable", days: 6 },
  { client: "Rohit Verma", label: "ITR filing", type: "Compliance", days: 12 },
] as const;

const STAFF_ROWS = [
  { name: "Priya S. — Partner", allocated: 40, actual: 38 },
  { name: "Arjun K. — Manager", allocated: 40, actual: 44 },
  { name: "Neha R. — Associate", allocated: 35, actual: 22 },
  { name: "Vikram T. — Staff", allocated: 30, actual: 31 },
] as const;

const COCKPIT_SCREENS = [
  { title: "Client roster", rows: ROSTER_ROWS },
  { title: "Deadline radar", rows: DEADLINE_ROWS },
  { title: "Staff utilization", rows: STAFF_ROWS },
] as const;

function PracticeCockpit() {
  const frames = useMemo(() => {
    const f: { s: number; v: number }[] = [];
    COCKPIT_SCREENS.forEach((sc, si) => {
      for (let v = 0; v <= sc.rows.length; v++) f.push({ s: si, v });
      for (let h = 0; h < 3; h++) f.push({ s: si, v: sc.rows.length });
    });
    return f;
  }, []);

  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % frames.length), 900);
    return () => clearInterval(id);
  }, [frames.length]);

  const { s, v } = frames[i];
  const screen = COCKPIT_SCREENS[s];

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-ct-border bg-white shadow-card overflow-hidden">
        {/* browser chrome */}
        <div className="flex items-center gap-1.5 border-b border-ct-border bg-ct-cloud px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-300" />
          <span className="size-2.5 rounded-full bg-yellow-300" />
          <span className="size-2.5 rounded-full bg-green-300" />
          <span className="ml-3 rounded bg-white px-3 py-0.5 text-[11px] text-ct-muted">the-firm.app/practice</span>
        </div>

        <div className="p-5 min-h-[340px] bg-gradient-to-b from-white to-ct-cream">
          <div className="flex items-center justify-between">
            <div className="font-heading text-lg text-ct-navy leading-tight">{screen.title}</div>
            <div className="flex items-center gap-1.5 text-xs text-ct-muted">
              {screen.title === "Deadline radar" && <AlertTriangle className="size-3.5 text-ct-saffron" />}
              {screen.title === "Staff utilization" && <UserCheck className="size-3.5 text-ct-teal" />}
              {screen.title === "Client roster" && <Users className="size-3.5 text-ct-slate" />}
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {screen.rows.map((row, idx) => {
              const revealed = idx < v;
              return (
                <div
                  key={`${s}-${idx}`}
                  className={`rounded-xl border px-3.5 py-3 text-sm transition-opacity border-ct-border bg-white ${
                    revealed ? "opacity-100 animate-in fade-in slide-in-from-bottom-1 duration-300" : "opacity-30"
                  }`}
                >
                  {"lines" in row && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ct-navy">{row.name}</span>
                      <span className="rounded-full bg-ct-teal/10 px-2 py-0.5 text-[11px] font-medium text-ct-teal shrink-0">{row.due}</span>
                    </div>
                  )}
                  {"lines" in row && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.lines.map((l) => (
                        <span key={l} className="rounded-md bg-ct-cloud px-2 py-0.5 text-[10px] font-medium text-ct-slate">{l}</span>
                      ))}
                      <span className="rounded-md bg-ct-navy/5 px-2 py-0.5 text-[10px] font-medium text-ct-navy">{row.partner}</span>
                    </div>
                  )}

                  {"type" in row && (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-ct-navy">{row.label}</span>
                        <span className="ml-2 text-[11px] text-ct-muted">{row.client}</span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${row.days <= 5 ? "bg-red-50 text-red-500" : "bg-ct-saffron/10 text-ct-saffron"}`}>
                        {row.days}d
                      </span>
                    </div>
                  )}

                  {"allocated" in row && (
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-ct-navy">{row.name}</span>
                        <span className="text-ct-muted">{row.actual}h / {row.allocated}h</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-ct-cloud overflow-hidden">
                        <div
                          className={`h-full rounded-full ${row.actual > row.allocated ? "bg-red-300" : "bg-ct-teal"}`}
                          style={{ width: `${Math.min(100, Math.round((row.actual / row.allocated) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5">
        {COCKPIT_SCREENS.map((_, idx) => (
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
        <div className="font-heading text-xl text-ct-muted italic">&ldquo;We serve fifty clients. Only I know which ones are on fire.&rdquo;</div>
        <h2 className="mt-3 font-heading text-3xl md:text-4xl text-ct-navy">
          Big firms have systems.
          <br className="hidden sm:block" /> Small firms have you.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          A firm of 4-20 people has all the client complexity of a Big 4 practice, with none of the practice-
          management systems — that's the one thing we designed this around.
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
            Everything a practice runs on. <span className="text-ct-saffron">One system.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
            CA, CS, Legal, GRC, and Audit — five service lines covered from day one, each client scoped to exactly
            the ones they actually need.
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

        <div className="mt-10 rounded-2xl bg-ct-cloud p-6">
          <div className="text-sm font-semibold text-ct-muted">Covered from day one</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SERVICE_LINES_SAMPLE.map((c) => (
              <span key={c} className="rounded-md bg-white border border-ct-border px-2.5 py-1 text-xs text-ct-slate">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Four steps to a firm that runs itself.</h2>
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
          <Sparkles className="size-3.5 text-ct-saffron" /> Same platform, everything already tracked
        </div>
        <h2 className="mt-5 font-heading text-3xl md:text-4xl">Built on VERIDIAN AI OS</h2>
        <p className="mx-auto mt-3 max-w-2xl text-white/70">
          Already tracking GRC, legal matters, company secretarial, or audit engagements for your clients on VERIDIAN?
          THE FIRM sits directly on top — every compliance item, legal matter, and audit engagement you've already
          logged per client shows up on your practice dashboard automatically, with nothing to re-enter.
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
          <h2 className="mt-4 font-heading text-3xl md:text-4xl text-ct-navy">Firm owners who got their visibility back</h2>
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
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Simple, per-staff-seat pricing.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          No separate charge for tax-case workflow, staff capacity, or billing — it's all included. Start free; pay
          only once your practice is live.
        </p>
      </div>
      <div className="mt-12 grid md:grid-cols-3 gap-5 items-start">
        {PRICING.map((p) => (
          <div
            key={p.name}
            className={`rounded-2xl border p-7 bg-white ${
              p.highlight ? "border-2 border-ct-saffron shadow-saffron relative" : "border-ct-border"
            }`}
          >
            {p.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ct-saffron px-3 py-1 text-xs font-semibold text-white">
                Most popular
              </div>
            )}
            <div className="text-lg font-semibold text-ct-navy">{p.name}</div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="font-heading text-4xl text-ct-navy">{p.price}</span>
              <span className="text-sm text-ct-muted">{p.unit}</span>
            </div>
            <p className="mt-2 text-sm text-ct-slate">{p.tagline}</p>
            <Link href="/signup">
              <Button
                className={`mt-5 w-full rounded-full ${
                  p.highlight
                    ? "bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                    : "bg-ct-navy hover:bg-ct-navy/90 text-white"
                }`}
              >
                {p.cta}
              </Button>
            </Link>
            <ul className="mt-6 space-y-2.5">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-ct-slate">
                  <Check className="mt-0.5 size-4 shrink-0 text-ct-teal" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24">
      <div className="rounded-3xl bg-ct-navy px-8 py-16 text-center text-white">
        <ShieldCheck className="mx-auto size-8 text-ct-saffron" />
        <h2 className="mt-4 font-heading text-3xl md:text-5xl">Give your practice the visibility a Big 4 firm has.</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">
          One client roster. One deadline radar. One staff-utilization view. Bill from unbilled hours in one click.
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
            <Briefcase className="size-3.5 text-ct-saffron" />
          </span>
          <span className="font-heading text-ct-navy">THE FIRM AI OS</span>
          <span className="text-sm text-ct-muted">— part of VERIDIAN AI OS</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-ct-muted">
          <a href="#features" className="hover:text-ct-navy">Features</a>
          <a href="#pricing" className="hover:text-ct-navy">Pricing</a>
          <Link href="/login" className="hover:text-ct-navy">Log in</Link>
        </div>
        <div className="text-sm text-ct-muted">© {new Date().getFullYear()} VERIDIAN AI</div>
      </div>
    </footer>
  );
}

export default function TheFirmLandingPage() {
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
      <ProductSalesSection product="THE FIRM AI OS" />
      <FinalCta />
      <Footer />
      <LegalBar />
      <VisitorIntelligence page="/the-firm" productKey="the_firm" />
    </main>
  );
}
