"use client";

// VERI FM & CS AI OS — public product landing page.
//
// Positioning (deliberate, and different from the parent VERIDIAN site):
// the last attempt at this exact product category (facilities management
// software) failed on ONE thing — ground-staff adoption. Housekeeping,
// technicians, security guards, canteen staff, reception could not or
// would not use it. So this page does NOT sell "AI-powered" as the
// headline; it sells FAMILIARITY — "the register you already keep,
// finally digital" — and only reveals the AI as the thing quietly doing
// the hard part (digitizing, scheduling, catching mistakes) behind the
// scenes. Same design system as veridian-ai-os.vercel.app (shared ct-*
// tokens, DM Serif Display + Inter, Button component) since this is a new
// product on the same VERIDIAN AI OS platform — see MASTER_AI_OS_ARCHITECTURE.md.
//
// SOCIAL-PROOF NOTE FOR THE OWNER: STORIES below are illustrative
// placeholders, not verified named customers — swap for real quotes as
// they come in. PRICING numbers are placeholders too. The asset-category
// count (28) and module list are real (shipped in this repo, Wave 107).

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import {
  ArrowRight,
  Check,
  Menu,
  X,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Star,
  Quote,
  Camera,
  QrCode,
  ClipboardList,
  Wrench,
  UserCheck,
  AlertTriangle,
  FileWarning,
  Smartphone,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductSalesSection } from "@/components/ProductSalesSection";
import { VisitorIntelligence } from "@/components/VisitorIntelligence";
import { LegalBar } from "@/components/LegalBar";

// --- Editable content -------------------------------------------------------

const STATS = [
  { value: "28", label: "equipment categories, out of the box" },
  { value: "0", label: "retyping — photo or Excel, in you go" },
  { value: "5", label: "PPM frequencies per asset, all at once" },
  { value: "1", label: "tap to complete a checklist" },
];

// Pain, per ground-reality persona — the exact roles the prior product
// failed to win over.
const PAINS = [
  {
    icon: Building2,
    persona: "You — Facilities / Admin Head",
    hook: "Your registers live in Excel, WhatsApp, and memory.",
    pains: [
      "Every campus keeps its own spreadsheet — no two spelled the same way",
      "AMC renewals get missed because nobody re-checked last year's sheet",
      "You find out an asset was never serviced only after it breaks down",
    ],
    flip: "One digital register for every asset, every campus — built from the very spreadsheets and photos you already have.",
  },
  {
    icon: Wrench,
    persona: "Your ground staff — technicians, guards, housekeeping",
    hook: "A new app is one more thing to learn, on a screen too small to type on.",
    pains: [
      "Physical registers are what they know — a new system feels like extra work",
      "Small phone screens make register-style typing painful and slow",
      "If it's not familiar, it doesn't get used — and old habits win",
    ],
    flip: "No typing. Scan the QR on the machine, tick the checklist, snap a photo if needed. Done in under a minute.",
  },
  {
    icon: FileWarning,
    persona: "Whoever has to trust the data",
    hook: "Nobody can tell if last month's numbers are even real.",
    pains: [
      '"Non VRV AC", "Non VRV Ac-2", "Borewel-1" — the same asset, three different spellings',
      "Formula errors from three years ago are still sitting in the sheet",
      "No one has time to go back and check what's accurate",
    ],
    flip: "AI flags likely duplicates and inconsistencies for a human to confirm — the register gets cleaner every month, not messier.",
  },
];

const FEATURES = [
  {
    icon: Camera,
    title: "Register Digitization",
    line: "Upload your existing Excel sheet, or just photograph a page of the physical register. AI reads it and stages a digital version — nothing commits until a human reviews and approves it.",
  },
  {
    icon: ClipboardList,
    title: "PPM & AMC, done right",
    line: "One asset can need weekly, monthly, quarterly AND yearly checks — all at once, the way real DG sets and AC units actually work. Track AMC contracts, renewal dates, and vendor visits against every asset.",
  },
  {
    icon: QrCode,
    title: "Scan-to-checklist",
    line: "Every asset gets a QR code. A technician scans it, sees exactly what's due today, and taps through — no searching, no typing, no confusion about which machine is which.",
  },
  {
    icon: AlertTriangle,
    title: "Catches the discrepancies",
    line: "Fuzzy-matching flags likely duplicate assets and inconsistent names for a human to confirm or dismiss — the exact mess every long-running register accumulates.",
  },
  {
    icon: UserCheck,
    title: "Visitor Management",
    line: "Front-desk check-in in seconds — search a returning visitor or add a new one, notify the host automatically, and check out with one tap.",
  },
  {
    icon: Smartphone,
    title: "Built for the phone in their pocket",
    line: "Camera-first, checkbox-heavy, big tap targets. It looks and feels like the register your team already trusts — just digital.",
  },
];

const ASSET_CATEGORIES_SAMPLE = [
  "DG Set", "VRV AC", "Transformer", "UPS", "Borewell", "Fire Fighting",
  "Passenger Lift", "RO System", "Solar System", "CCTV", "Water Tank", "and 17 more…",
];

const HOW_STEPS = [
  { n: "1", title: "Snap it or upload it", line: "A photo of the physical register page, or the Excel sheet you already keep — either way in." },
  { n: "2", title: "AI stages it, you approve", line: "Every extracted row is reviewed by a human before it becomes a real asset — never a silent auto-commit." },
  { n: "3", title: "Your team taps through", line: "Ground staff scan the asset's QR code, see today's checklist, tick it off. That's the whole workflow." },
];

// Illustrative — replace with real, attributable quotes when available.
const STORIES = [
  {
    quote:
      "Our technicians actually use it — because it isn't asking them to type, it's asking them to tap. That's the difference from the system we tried before.",
    who: "Facilities Manager",
    org: "Corporate campus, Gurugram",
  },
  {
    quote:
      "We photographed three years of paper logbooks in an afternoon. What used to be a dusty file cabinet is now a search bar.",
    who: "Admin Head",
    org: "School campus, Noida",
  },
  {
    quote:
      "It found four assets we'd logged twice under slightly different names. We didn't even know that discrepancy existed until it was flagged.",
    who: "Operations Head",
    org: "Manufacturing plant, Faridabad",
  },
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
    { href: "/?from=veri-fm-cs", label: "Research" },
  ];
  return (
    <nav className="sticky top-0 z-50 bg-ct-cream/80 backdrop-blur-md border-b border-ct-border/60">
      <div className="mx-auto max-w-6xl px-5 flex items-center justify-between h-16">
        <Link href="/veri-fm-cs" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ct-navy text-white">
            <Wrench className="size-4 text-ct-saffron" />
          </span>
          <span className="font-heading text-lg text-ct-navy tracking-tight">VERI FM &amp; CS</span>
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
              Facilities Management &amp; Corporate Services · Part of VERIDIAN AI OS
            </div>

            <h1 className="mt-6 font-heading text-4xl leading-[1.08] text-ct-navy sm:text-5xl xl:text-6xl">
              The register your team
              <br />
              <span className="text-ct-saffron">already trusts. Now digital.</span>
            </h1>

            <p className="mx-auto lg:mx-0 mt-5 max-w-xl text-lg text-ct-slate">
              Facilities software fails when ground staff won&apos;t use it. VERI FM &amp; CS keeps it familiar —
              photograph a register page or upload your Excel sheet, and{" "}
              <span className="font-semibold text-ct-navy">AI quietly builds the digital version</span>. Your
              technicians just scan a QR code and tap. No typing, no training.
            </p>
            <p className="mx-auto lg:mx-0 mt-3 max-w-xl text-sm font-medium text-ct-teal">
              It doesn&apos;t replace your ground staff — it gives them back the hours they used to spend writing
              things down twice.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/signup">
                <Button className="h-12 rounded-full bg-ct-saffron hover:bg-ct-saffron-hover px-7 text-base text-white shadow-saffron">
                  Digitize your first register <ArrowRight className="ml-1 size-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button variant="outline" className="h-12 rounded-full px-7 text-base border-ct-border text-ct-navy">
                  See how it works
                </Button>
              </a>
            </div>
            <p className="mt-4 text-sm text-ct-muted">No credit card · Upload your first sheet in 2 minutes · Built on VERIDIAN AI OS</p>
          </div>

          {/* the proof — a technician's phone, working */}
          <div>
            <ChecklistPhone />
            <p className="mt-3 text-center text-sm text-ct-muted">
              ↑ This is what a technician sees after scanning one QR code.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// A phone-framed, auto-looping recreation of the ground-staff checklist
// screen — deliberately NOT a desktop dashboard, since the whole point of
// this product is that the primary surface is a small screen in someone's
// pocket. Mirrors the parent site's AgentWindow rhythm (script → reveal →
// hold → repeat) but the artifact itself is the adoption story: tap
// checkboxes and a photo button, never a text field.
const CHECKLIST_SCENARIOS = [
  {
    asset: "DG Set — 180 KVA",
    freq: "Weekly PPM",
    items: [
      { t: "Check fuel level and top up if needed", done: true },
      { t: "Inspect battery terminals for corrosion", done: true },
      { t: "Check for unusual noise or vibration", done: true },
      { t: "Photo of control panel reading", done: false, photo: true },
    ],
  },
  {
    asset: "VRV AC — Outdoor Unit 18HP",
    freq: "Half-Yearly PPM",
    items: [
      { t: "Clean condenser coil", done: true },
      { t: "Check refrigerant pressure", done: true },
      { t: "Inspect compressor mounting", done: false },
      { t: "Test thermostat calibration", done: false },
    ],
  },
  {
    asset: "Passenger Lift — Block A",
    freq: "Monthly PPM",
    items: [
      { t: "Test emergency alarm & phone", done: true },
      { t: "Check door sensor response", done: true },
      { t: "Inspect cabin lighting", done: true },
      { t: "Log car-top inspection", done: false, photo: true },
    ],
  },
] as const;

function ChecklistPhone() {
  const frames = useMemo(() => {
    const f: { s: number; v: number }[] = [];
    CHECKLIST_SCENARIOS.forEach((sc, si) => {
      for (let v = 0; v <= sc.items.length; v++) f.push({ s: si, v });
      for (let h = 0; h < 3; h++) f.push({ s: si, v: sc.items.length });
    });
    return f;
  }, []);

  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % frames.length), 1000);
    return () => clearInterval(id);
  }, [frames.length]);

  const { s, v } = frames[i];
  const sc = CHECKLIST_SCENARIOS[s];
  const complete = v >= sc.items.length;

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-[2rem] border-8 border-ct-navy bg-white shadow-card overflow-hidden">
        {/* phone notch */}
        <div className="flex justify-center bg-ct-navy py-1.5">
          <div className="h-1 w-16 rounded-full bg-white/30" />
        </div>

        <div className="p-5 min-h-[420px] bg-gradient-to-b from-white to-ct-cream">
          <div className="flex items-center gap-2 text-xs text-ct-muted">
            <QrCode className="size-3.5 text-ct-saffron" /> Scanned via QR
          </div>
          <div className="mt-2 font-heading text-lg text-ct-navy leading-tight">{sc.asset}</div>
          <div
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              complete ? "bg-ct-saffron/10 text-ct-saffron" : "bg-ct-teal/10 text-ct-teal"
            }`}
          >
            {sc.freq} · {complete ? "Ready to submit" : "In progress"}
          </div>

          <div className="mt-5 space-y-2.5">
            {sc.items.map((item, idx) => {
              const revealed = idx < v
              const checked = revealed && item.done
              return (
                <div
                  key={`${s}-${idx}`}
                  className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-opacity ${
                    revealed ? "opacity-100 animate-in fade-in slide-in-from-bottom-1 duration-300" : "opacity-30"
                  } ${checked ? "border-ct-teal/40 bg-ct-teal/5" : "border-ct-border bg-white"}`}
                >
                  {"photo" in item && item.photo ? (
                    <span className={`grid size-5 shrink-0 place-items-center rounded-md ${checked ? "bg-ct-teal text-white" : "border border-ct-border text-ct-muted"}`}>
                      <Camera className="size-3" />
                    </span>
                  ) : (
                    <span className={`grid size-5 shrink-0 place-items-center rounded-md ${checked ? "bg-ct-teal text-white" : "border border-ct-border"}`}>
                      {checked && <Check className="size-3.5" />}
                    </span>
                  )}
                  <span className={`flex-1 ${checked ? "text-ct-navy" : "text-ct-slate"}`}>{item.t}</span>
                </div>
              )
            })}
          </div>

          {complete && (
            <button className="mt-5 w-full rounded-full bg-ct-saffron px-4 py-2.5 text-sm font-semibold text-white shadow-saffron">
              Submit checklist
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5">
        {CHECKLIST_SCENARIOS.map((_, idx) => (
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
        <div className="font-heading text-xl text-ct-muted italic">&ldquo;We built one of these before. Nobody on the ground used it.&rdquo;</div>
        <h2 className="mt-3 font-heading text-3xl md:text-4xl text-ct-navy">
          The software wasn&apos;t the problem.
          <br className="hidden sm:block" /> Adoption was.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
          Facilities software has never had a shortage of features. It's had a shortage of people who actually open
          it every day — and that's the one thing we designed this around.
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
            Everything a facilities team runs on. <span className="text-ct-saffron">One system.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-ct-slate">
            DG sets, AC units, transformers, borewells, fire fighting, lifts, CCTV — 28 equipment categories covered
            from day one, each with its own real-world maintenance rhythm.
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
            {ASSET_CATEGORIES_SAMPLE.map((c) => (
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
        <h2 className="font-heading text-3xl md:text-4xl text-ct-navy">Three steps. No retyping, ever.</h2>
      </div>
      <div className="mt-12 grid md:grid-cols-3 gap-6">
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
          <Sparkles className="size-3.5 text-ct-saffron" /> Same platform, one more department covered
        </div>
        <h2 className="mt-5 font-heading text-3xl md:text-4xl">Built on VERIDIAN AI OS</h2>
        <p className="mx-auto mt-3 max-w-2xl text-white/70">
          VERI FM &amp; CS is a product on the same platform that already runs finance, sales, HR, and compliance for
          hundreds of teams. If your organisation grows into needing more than facilities, everything else is already
          there, on the same login.
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
          <h2 className="mt-4 font-heading text-3xl md:text-4xl text-ct-navy">Teams whose ground staff actually adopted it</h2>
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
        What a portfolio pays should track its own asset count and sites — not a rate card. Tell us about your
        facilities and we&apos;ll work out a number that pays for itself.
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
        <h2 className="mt-4 font-heading text-3xl md:text-5xl">Give your team a register they&apos;ll actually use.</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/70">
          Upload what you already have. Let AI build the digital version. Watch your ground staff adopt it because it
          finally feels familiar.
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
            <Wrench className="size-3.5 text-ct-saffron" />
          </span>
          <span className="font-heading text-ct-navy">VERI FM &amp; CS AI OS</span>
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

export default function VeriFmCsLandingPage() {
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
      <CostCta />
      <ProductSalesSection product="VERI FM & CS AI OS" />
      <FinalCta />
      <Footer />
      <LegalBar />
      <VisitorIntelligence page="/veri-fm-cs" productKey="facilities_management" />
    </main>
  );
}
