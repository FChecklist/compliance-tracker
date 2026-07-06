"use client";

// VERIDIAN AI — public landing page.
//
// Positioning (deliberate): VERIDIAN is sold as a *worker*, not a tool. The
// whole page leads with the assistant and with outcomes ("tell it, it's
// done"), and lets breadth (finance / sales / HR / ops / compliance) show up
// only as things you can *ask it to do* — never as an ERP-style module grid.
// That reframing is what keeps this from looking like Odoo / Zoho / Tally.
//
// SOCIAL-PROOF NOTE FOR THE OWNER: the stat band (STATS) and testimonials
// (STORIES) are ILLUSTRATIVE PLACEHOLDERS written by role/industry, not
// verified named customers. Swap them for real figures/quotes as they come
// in — publishing fabricated counts/reviews on a live paid page is a
// misleading-advertising risk (India CCPA fake-review rules / ASCI). Pricing
// numbers in PRICING are placeholders too — set your real prices there.

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import {
  ArrowRight,
  Check,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  Zap,
  Users,
  Wallet,
  Send,
  CheckCircle2,
  Star,
  Quote,
  Loader2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// --- Editable content -------------------------------------------------------

// Illustrative until real metrics exist — see owner note at top of file.
const STATS = [
  { value: "1,000+", label: "teams onboard" },
  { value: "20+", label: "countries" },
  { value: "4.2M", label: "tasks completed" },
  { value: "5.4×", label: "average ROI" },
];

const ASK_EXAMPLES = [
  "Raise this month's GST invoices and send them for approval",
  "Chase the 3 overdue payments and log what they say",
  "Onboard the new hire — offer letter, PF, and payroll",
  "Summarise yesterday's sales calls and update the pipeline",
];

const OFFICE = [
  {
    icon: Wallet,
    title: "Finance & Accounting",
    line: "Invoices, GST, TDS, books, and month-end — asked for, not filled in.",
  },
  {
    icon: Users,
    title: "Sales & CRM",
    line: "Follow-ups chased, pipeline updated, quotes drafted while you sleep.",
  },
  {
    icon: Sparkles,
    title: "People & HR",
    line: "Hiring, onboarding, leave, and payroll — handled end to end.",
  },
  {
    icon: Zap,
    title: "Operations & Supply",
    line: "Orders, stock, vendors, and dispatch kept moving on their own.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance & Legal",
    line: "Deadlines tracked, notices answered, records audit-ready always.",
  },
];

const WOW = [
  {
    title: "A worker for every employee",
    line: "Not one shared chatbot. Each person gets their own assistant that knows their job and does it.",
  },
  {
    title: "It does the work — not just tracks it",
    line: "Dashboards tell you what's wrong. VERIDIAN fixes it, then shows you what it did for your approval.",
  },
  {
    title: "It learns your business",
    line: "Your customers, your rules, your way of doing things. The more you use it, the sharper it gets.",
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
      "It replaced four different tools and a part-time accountant. My team just tells it what they need and it's done before I've finished my coffee.",
    who: "Founder",
    org: "D2C brand, Bengaluru",
  },
  {
    quote:
      "We went from missing filings to never missing one. Nobody chases spreadsheets any more — the assistant chases us.",
    who: "Finance Head",
    org: "Mid-size manufacturer, Pune",
  },
  {
    quote:
      "Every salesperson now has a back-office. Follow-ups happen on their own and our close rate is up noticeably.",
    who: "Sales Director",
    org: "IT services firm, Gurugram",
  },
];

// Placeholder pricing — set your real prices here.
const PRICING = [
  {
    name: "Starter",
    price: "₹499",
    unit: "/ user / month",
    tagline: "For small teams getting their first assistants.",
    features: ["Up to 10 users", "Every core assistant", "Email + chat support", "2-minute setup"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Business",
    price: "₹999",
    unit: "/ user / month",
    tagline: "For growing companies running the whole office on VERIDIAN.",
    features: [
      "Unlimited users",
      "All departments & assistants",
      "Build your own agents",
      "Priority support",
      "Advanced automations",
    ],
    cta: "Start free",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    tagline: "For larger organisations with security & scale needs.",
    features: ["Everything in Business", "SSO & advanced security", "Dedicated success manager", "Custom integrations"],
    cta: "Talk to us",
    highlight: false,
  },
];

// --- Sections ---------------------------------------------------------------

function Nav() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: "#how", label: "How it works" },
    { href: "#office", label: "What it does" },
    { href: "#pricing", label: "Pricing" },
    { href: "#stories", label: "Stories" },
  ];
  return (
    <nav className="sticky top-0 z-50 bg-ct-cream/80 backdrop-blur-md border-b border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ct-navy text-white">
            <Sparkles className="size-4 text-ct-saffron" />
          </span>
          <span className="font-heading text-lg text-ct-navy tracking-tight">VERIDIAN</span>
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

      <div className="mx-auto max-w-6xl px-5 pt-16 pb-14 md:pt-24 md:pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-ct-border bg-white/70 px-4 py-1.5 text-xs font-medium text-ct-slate">
          <span className="size-1.5 rounded-full bg-ct-teal" />
          Your AI workforce — one assistant for every person on your team
        </div>

        <h1 className="mt-6 font-heading text-4xl leading-[1.1] text-ct-navy sm:text-6xl">
          Tell it what to do.
          <br />
          <span className="text-ct-saffron">Consider it done.</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg text-ct-slate">
          VERIDIAN is a trusted assistant for your whole office. Every employee gets one. You just say what you need —
          in plain words — and it does the actual work. Finance, sales, people, operations, compliance. One tool.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/signup">
            <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 text-base text-white shadow-saffron">
              Open your account <ArrowRight className="ml-1 size-4" />
            </Button>
          </Link>
          <a href="#how">
            <Button variant="outline" className="h-12 rounded-full px-7 text-base border-ct-border text-ct-navy">
              See how it works
            </Button>
          </a>
        </div>
        <p className="mt-4 text-sm text-ct-muted">No credit card needed · Live in 2 minutes · 5× your productivity or your money back</p>

        {/* The product IS the advertisement: a live, auto-playing window of the
            real Home/assistant screen working through tasks. */}
        <AgentWindow />
        <p className="mt-4 text-sm text-ct-muted">This is the actual screen your team sees — working, all day, for you.</p>
      </div>
    </section>
  );
}

// The hero centrepiece — a browser-framed, auto-looping recreation of the Home
// assistant screen. Each scenario streams: a request → tasks it completed →
// one thing left "pending your approval". Deliberately a scripted showreel
// (representative tasks), not the live logged-in app, so it plays instantly
// with no sign-in and always tells a clean story.
const HERO_SCENARIOS = [
  {
    who: "You",
    command: "Raise this month's invoices and send them out",
    steps: [
      { t: "Pulled 24 clients due this billing cycle", k: "done" },
      { t: "Drafted 24 GST-ready invoices", k: "done" },
      { t: "Cross-checked each against last month — all correct", k: "done" },
      { t: "Send all 24 invoices to clients", k: "approve" },
    ],
  },
  {
    who: "Priya · Sales",
    command: "Chase the 3 overdue payments and tell me what they say",
    steps: [
      { t: "Reviewed 3 overdue invoices (₹4.2L total)", k: "done" },
      { t: "Sent polite reminders to all three", k: "done" },
      { t: "Acme replied — paying Friday. Logged it.", k: "done" },
      { t: "Escalate the one client who didn't respond", k: "approve" },
    ],
  },
  {
    who: "Rahul · HR",
    command: "Onboard our new hire, Meera",
    steps: [
      { t: "Generated her offer letter and sent for e-sign", k: "done" },
      { t: "Set up PF, ESI and payroll", k: "done" },
      { t: "Created her email and app accounts", k: "done" },
      { t: "Release her first-month salary", k: "approve" },
    ],
  },
] as const;

function AgentWindow() {
  // Flatten every scenario into a frame list so the ticker is a simple index
  // walk — no stale-closure risk from reading state inside the interval.
  const frames = useMemo(() => {
    const f: { s: number; v: number }[] = [];
    HERO_SCENARIOS.forEach((sc, si) => {
      for (let v = 0; v <= sc.steps.length; v++) f.push({ s: si, v });
      for (let h = 0; h < 3; h++) f.push({ s: si, v: sc.steps.length }); // hold on completion
    });
    return f;
  }, []);

  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % frames.length), 900);
    return () => clearInterval(id);
  }, [frames.length]);

  const { s, v } = frames[i];
  const sc = HERO_SCENARIOS[s];
  const complete = v >= sc.steps.length;

  return (
    <div className="mx-auto mt-12 max-w-3xl">
      <div className="rounded-2xl border border-ct-border bg-white shadow-card overflow-hidden text-left">
        {/* browser chrome */}
        <div className="flex items-center gap-2 border-b border-ct-border bg-ct-cloud px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-300" />
          <span className="size-2.5 rounded-full bg-yellow-300" />
          <span className="size-2.5 rounded-full bg-green-300" />
          <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-ct-muted">
            veridian-ai-os.vercel.app/home
          </div>
        </div>

        {/* app body */}
        <div className="p-5 sm:p-7 min-h-[360px] bg-gradient-to-b from-white to-ct-cream">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-heading text-lg text-ct-navy">Good morning 👋</div>
              <div className="text-sm text-ct-muted">Here&apos;s what I&apos;m getting done for you.</div>
            </div>
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                complete ? "bg-ct-saffron/10 text-ct-saffron" : "bg-ct-teal/10 text-ct-teal"
              }`}
            >
              {complete ? (
                <>
                  <Clock className="size-3.5" /> Awaiting your approval
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Working…
                </>
              )}
            </div>
          </div>

          {/* the request */}
          <div className="mt-5 flex justify-end">
            <div className="flex items-center gap-2 rounded-2xl rounded-br-sm bg-ct-navy px-4 py-2.5 text-sm text-white max-w-[85%]">
              <span className="text-white/50 text-xs">{sc.who}:</span>
              {sc.command}
            </div>
          </div>

          {/* the assistant working */}
          <div className="mt-4 space-y-2">
            {sc.steps.slice(0, v).map((step, idx) => (
              <div
                key={`${s}-${idx}`}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300 ${
                  step.k === "approve"
                    ? "border-ct-saffron/40 bg-ct-saffron/5 text-ct-navy"
                    : "border-ct-border bg-white text-ct-slate"
                }`}
              >
                {step.k === "approve" ? (
                  <Clock className="size-4 shrink-0 text-ct-saffron" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-ct-teal" />
                )}
                <span className="flex-1">{step.t}</span>
                {step.k === "approve" ? (
                  <span className="shrink-0 rounded-full bg-ct-saffron px-3 py-1 text-xs font-semibold text-white">
                    Approve
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-ct-teal">Done</span>
                )}
              </div>
            ))}
            {!complete && (
              <div className="flex items-center gap-2.5 px-3.5 py-1 text-sm text-ct-muted">
                <Loader2 className="size-4 shrink-0 animate-spin text-ct-saffron" />
                Working on the next step…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* progress dots per scenario */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {HERO_SCENARIOS.map((_, idx) => (
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

function Shift() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Not another system your team has to run</h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          Every other business tool gives you more forms to fill and more screens to check. VERIDIAN gives you someone
          who does it for you.
        </p>
      </div>

      <div className="mt-10 grid md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-ct-border bg-white p-7">
          <div className="text-sm font-semibold text-ct-muted">The old way</div>
          <ul className="mt-4 space-y-3 text-ct-slate">
            {["Learn 20 modules and menus", "Someone has to enter everything", "Dashboards that only report problems", "A new hire and a month of training", "You still do the chasing"].map(
              (t) => (
                <li key={t} className="flex items-start gap-2">
                  <X className="mt-0.5 size-4 shrink-0 text-ct-muted" />
                  <span>{t}</span>
                </li>
              ),
            )}
          </ul>
        </div>
        <div className="rounded-2xl border-2 border-ct-saffron/40 bg-ct-saffron/5 p-7">
          <div className="text-sm font-semibold text-ct-saffron">With VERIDIAN</div>
          <ul className="mt-4 space-y-3 text-ct-navy">
            {["Just say what you need in plain words", "It does the entering, chasing, drafting", "It fixes things, then asks for your yes", "Anyone can use it on day one", "Your whole office, handled"].map(
              (t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-ct-teal" />
                  <span>{t}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function How() {
  const steps = [
    { n: "1", title: "Tell it", line: "Type or say what you want, the way you'd tell a colleague. No forms, no training." },
    { n: "2", title: "It works", line: "VERIDIAN does the real work across your business — and shows you exactly what it did." },
    { n: "3", title: "You approve", line: "Anything that matters waits for your one-tap yes. You stay in control, always." },
  ];
  return (
    <section id="how" className="bg-white border-y border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Three steps. That&apos;s the whole thing.</h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-ct-border p-7">
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
      </div>
    </section>
  );
}

function Office() {
  return (
    <section id="office" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">One assistant. Your whole office.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          The complete power of an office, in your hand. No separate software for each department — just ask.
        </p>
      </div>
      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {OFFICE.map((o) => (
          <div key={o.title} className="rounded-2xl border border-ct-border bg-white p-6 hover:shadow-card transition-shadow">
            <div className="grid size-11 place-items-center rounded-xl bg-ct-teal/10">
              <o.icon className="size-5 text-ct-teal" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-ct-navy">{o.title}</h3>
            <p className="mt-1.5 text-sm text-ct-slate">{o.line}</p>
          </div>
        ))}
        <div className="rounded-2xl border-2 border-dashed border-ct-border bg-ct-cloud p-6 flex flex-col justify-center">
          <h3 className="text-lg font-semibold text-ct-navy">…and whatever else you need</h3>
          <p className="mt-1.5 text-sm text-ct-slate">
            If it&apos;s office work, VERIDIAN can do it — or build you a custom agent for it in minutes.
          </p>
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
          <h2 className="font-heading text-3xl md:text-4xl">Why it feels different</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/70">
            This isn&apos;t a chatbot bolted onto old software. It&apos;s a worker that actually works for you.
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
          Save at least <span className="text-ct-saffron">5×</span> what you spend
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-ct-slate">
          One VERIDIAN seat costs less than a few hours of a person&apos;s time — and gives back days of it every month.
          Fewer tools, fewer mistakes, fewer people stuck on busywork. Most teams make their money back in the first
          week.
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          {[
            ["5×", "more done per person"],
            ["~0", "errors on routine work"],
            ["Day 1", "everyone productive"],
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
          <h2 className="mt-4 font-heading text-3xl md:text-4xl text-ct-navy">Teams that stopped doing busywork</h2>
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
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Simple pricing. An assistant for everyone.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          Priced per person, because every person gets their own worker. Start free — pay only when it&apos;s already
          saving you money.
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
            <Link href={p.name === "Enterprise" ? "/signup" : "/signup"}>
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
        <h2 className="mt-4 font-heading text-3xl md:text-5xl">100% reliable. 100% trusted.</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">
          Give every person on your team an assistant that just gets it done. It takes two minutes to start — and
          you&apos;ll feel the difference today.
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
          <span className="text-sm text-ct-muted">— your trusted assistant</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-ct-muted">
          <a href="#how" className="hover:text-ct-navy">How it works</a>
          <a href="#pricing" className="hover:text-ct-navy">Pricing</a>
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
      <Shift />
      <How />
      <Office />
      <Wow />
      <Roi />
      <Stories />
      <Pricing />
      <FinalCta />
      <Footer />
    </main>
  );
}
