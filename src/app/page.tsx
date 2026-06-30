"use client";

import Image from "next/image";
import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Upload,
  Bell,
  Search,
  Brain,
  Globe,
  ArrowRight,
  Check,
  ChevronDown,
  Zap,
  FileText,
  CalendarClock,
  AlertTriangle,
  IndianRupee,
  Calculator,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/* ─────────────────────────── DATA ─────────────────────────── */

const PENALTY_RATES: Record<
  string,
  {
    label: string;
    interestRate: number;
    interestPeriod: "monthly" | "yearly";
    penaltyPerDay?: number;
    penaltyMax?: number;
    fixedPenalty?: number;
  }
> = {
  GST: {
    label: "GST (GSTR-3B / GSTR-1 / GSTR-9)",
    interestRate: 18,
    interestPeriod: "yearly",
    penaltyPerDay: 200,
    penaltyMax: 5000,
  },
  TDS: {
    label: "TDS (Section 201 / 206C)",
    interestRate: 1.5,
    interestPeriod: "monthly",
    fixedPenalty: 0,
  },
  PF: {
    label: "PF (EPF / ESI)",
    interestRate: 12,
    interestPeriod: "yearly",
    penaltyPerDay: 0,
  },
  INCOME_TAX: {
    label: "Income Tax (ITR / Advance Tax)",
    interestRate: 1,
    interestPeriod: "monthly",
  },
  MCA: {
    label: "MCA / ROC (AOC-4 / MGT-7)",
    interestRate: 0,
    interestPeriod: "yearly",
    penaltyPerDay: 100,
    penaltyMax: 100000,
  },
  ESIC: {
    label: "ESIC Contribution",
    interestRate: 12,
    interestPeriod: "yearly",
  },
};

interface PenaltyResult {
  daysOverdue: number;
  interestAmount: number;
  penaltyAmount: number;
  totalLiability: number;
}

function calculatePenalty(
  complianceType: string,
  amount: number,
  dueDate: string,
  paymentDate: string
): PenaltyResult | null {
  const due = new Date(dueDate);
  const payment = new Date(paymentDate);
  if (isNaN(due.getTime()) || isNaN(payment.getTime()) || payment <= due) {
    return null;
  }

  const diffMs = payment.getTime() - due.getTime();
  const daysOverdue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const rates = PENALTY_RATES[complianceType];
  if (!rates) return null;

  let interestAmount = 0;
  const baseAmount = Math.max(amount, 0);

  if (rates.interestPeriod === "monthly") {
    const months = daysOverdue / 30;
    interestAmount = baseAmount * (rates.interestRate / 100) * months;
  } else {
    const years = daysOverdue / 365;
    interestAmount = baseAmount * (rates.interestRate / 100) * years;
  }

  let penaltyAmount = 0;
  if (rates.penaltyPerDay && rates.penaltyPerDay > 0) {
    penaltyAmount = daysOverdue * rates.penaltyPerDay;
    if (rates.penaltyMax) {
      penaltyAmount = Math.min(penaltyAmount, rates.penaltyMax);
    }
  }

  return {
    daysOverdue,
    interestAmount: Math.round(interestAmount),
    penaltyAmount: Math.round(penaltyAmount),
    totalLiability: Math.round(interestAmount + penaltyAmount),
  };
}

const formatINR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

/* ─────────────────────── ANIMATION VARIANTS ───────────────── */

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: "easeOut" },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

/* ─────────────────────── COMPONENTS ──────────────────────── */

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <motion.nav
      initial={{ y: -80 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed top-0 inset-x-0 z-50 h-16 bg-gradient-navy shadow-nav"
    >
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <a href="/" className="flex items-center">
          <Image src="/logo-compact.svg" alt="Veridian AI" width={140} height={28} className="h-7 w-auto" priority unoptimized />
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8 text-sm text-white/80">
          <a href="#features" className="hover:text-ct-saffron transition-colors">
            Features
          </a>
          <a href="#calculator" className="hover:text-ct-saffron transition-colors">
            Penalty Calculator
          </a>
          <a href="#how-it-works" className="hover:text-ct-saffron transition-colors">
            How It Works
          </a>
          <a href="#compliance-types" className="hover:text-ct-saffron transition-colors">
            Compliance Types
          </a>
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10">
            Log In
          </Button>
          <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
            Start Free Trial
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-white p-2"
          aria-label="Toggle menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden bg-gradient-navy border-t border-white/10 overflow-hidden"
          >
            <div className="flex flex-col gap-1 p-4 text-white/80">
              <a href="#features" onClick={() => setOpen(false)} className="py-2 px-3 rounded-lg hover:bg-white/10">Features</a>
              <a href="#calculator" onClick={() => setOpen(false)} className="py-2 px-3 rounded-lg hover:bg-white/10">Penalty Calculator</a>
              <a href="#how-it-works" onClick={() => setOpen(false)} className="py-2 px-3 rounded-lg hover:bg-white/10">How It Works</a>
              <a href="#compliance-types" onClick={() => setOpen(false)} className="py-2 px-3 rounded-lg hover:bg-white/10">Compliance</a>
              <div className="flex gap-2 pt-2 border-t border-white/10 mt-2">
                <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10 flex-1">Log In</Button>
                <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron flex-1">
                  Start Free Trial
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-[92vh] flex items-center overflow-hidden pt-16">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 -left-20 size-72 rounded-full bg-ct-saffron/10 blur-3xl" />
        <div className="absolute bottom-20 -right-20 size-96 rounded-full bg-ct-teal/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-ct-saffron/[0.03] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left - Copy */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="text-center lg:text-left"
          >
            <motion.div variants={fadeUp} custom={0}>
              <Badge
                variant="outline"
                className="rounded-full border-ct-saffron/30 bg-ct-saffron/10 text-ct-saffron px-4 py-1 text-xs font-medium mb-6"
              >
                <Zap className="size-3 mr-1.5" />
                AI-Native Compliance &amp; Audit Operating System
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="font-heading text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-6xl text-ct-navy leading-[1.1] tracking-tight"
            >
              Never miss a{" "}
              <span className="text-ct-saffron">compliance deadline</span>{" "}
              again
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-6 text-base sm:text-lg text-ct-muted leading-relaxed max-w-xl mx-auto lg:mx-0"
            >
              Upload a government notice PDF — AI fills the form. Track every
              filing, every challan, every ARN. The single source of truth for
              Indian compliance that works alongside your CA, Tally, and GSTN
              portal.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start"
            >
              <Button
                size="lg"
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron h-12 px-8 text-base"
              >
                Start 14-Day Free Trial
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-ct-navy/20 text-ct-navy hover:bg-ct-cloud h-12 px-8 text-base"
              >
                Try Penalty Calculator
                <ChevronDown className="ml-2 size-4" />
              </Button>
            </motion.div>

            <motion.div
              variants={fadeUp}
              custom={4}
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center lg:justify-start text-sm text-ct-muted"
            >
              <span className="flex items-center gap-1.5">
                <Check className="size-4 text-ct-teal" /> No credit card required
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-4 text-ct-teal" /> 14-day full access
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-4 text-ct-teal" /> Setup in 5 minutes
              </span>
            </motion.div>
          </motion.div>

          {/* Right - Hero Visual */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
            className="relative"
          >
            <div className="relative rounded-2xl bg-white shadow-card border border-ct-border p-6">
              {/* Mock dashboard preview */}
              <div className="flex items-center gap-2 mb-5">
                <div className="size-3 rounded-full bg-ct-error" />
                <div className="size-3 rounded-full bg-ct-saffron" />
                <div className="size-3 rounded-full bg-ct-teal" />
                <div className="ml-3 h-3 w-40 rounded-full bg-ct-cloud" />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Total Items", value: "247", color: "text-ct-navy" },
                  { label: "Overdue", value: "12", color: "text-ct-error" },
                  { label: "Due This Week", value: "18", color: "text-ct-saffron" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl bg-ct-cloud/60 p-3 text-center"
                  >
                    <div className={`text-2xl font-bold ${s.color}`}>
                      {s.value}
                    </div>
                    <div className="text-[10px] text-ct-muted mt-0.5">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Mock compliance items */}
              <div className="space-y-2">
                {[
                  {
                    title: "GSTR-3B — Maharashtra",
                    status: "Overdue",
                    statusColor: "bg-ct-error-light text-ct-error",
                    days: "5 days ago",
                  },
                  {
                    title: "TDS Section 194C — Q1",
                    status: "Due in 3 days",
                    statusColor: "bg-ct-warning-light text-ct-warning",
                    days: "Jul 7, 2026",
                  },
                  {
                    title: "PF Monthly — June",
                    status: "Completed",
                    statusColor: "bg-ct-success-light text-ct-success",
                    days: "Jun 28, 2026",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center justify-between rounded-lg bg-ct-cream/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-2 rounded-full bg-ct-saffron" />
                      <div>
                        <div className="text-xs font-medium text-ct-navy">
                          {item.title}
                        </div>
                        <div className="text-[10px] text-ct-muted">
                          {item.days}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-2 py-0.5 font-medium ${item.statusColor}`}
                    >
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>

              {/* AI extraction callout */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2, duration: 0.5 }}
                className="mt-4 flex items-center gap-2 rounded-lg bg-ct-saffron/5 border border-ct-saffron/20 p-3"
              >
                <Brain className="size-4 text-ct-saffron shrink-0" />
                <p className="text-[11px] text-ct-slate">
                  <span className="font-semibold text-ct-saffron">AI:</span>{" "}
                  Detected SCN notice uploaded — extracted notice no.{" "}
                  <span className="font-mono text-ct-navy">
                    GST/SVN/2026/04521
                  </span>
                  , demand ₹2,34,000, reply deadline: Jul 15, 2026
                </p>
              </motion.div>
            </div>

            {/* Floating card decorations */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
              className="absolute -top-4 -right-4 rounded-xl bg-white shadow-card border border-ct-border px-4 py-2.5 hidden lg:flex items-center gap-2"
            >
              <IndianRupee className="size-4 text-ct-teal" />
              <div>
                <div className="text-[10px] text-ct-muted">Estimated Penalty</div>
                <div className="text-sm font-bold text-ct-error">₹47,800</div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{
                repeat: Infinity,
                duration: 5,
                ease: "easeInOut",
                delay: 1,
              }}
              className="absolute -bottom-3 -left-4 rounded-xl bg-white shadow-card border border-ct-border px-4 py-2.5 hidden lg:flex items-center gap-2"
            >
              <AlertTriangle className="size-4 text-ct-saffron" />
              <div>
                <div className="text-[10px] text-ct-muted">Deadlines This Week</div>
                <div className="text-sm font-bold text-ct-navy">18 filings</div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const logos = [
    "GST",
    "TDS",
    "MCA",
    "EPF",
    "ESIC",
    "ITR",
    "ROC",
    "Labour",
  ];
  return (
    <section className="border-y border-ct-border bg-white/60 py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-semibold tracking-widest text-ct-muted uppercase mb-6">
          Covers all major Indian compliance types
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          {logos.map((name) => (
            <div
              key={name}
              className="flex items-center justify-center h-12 w-20 sm:w-24 rounded-xl bg-ct-cloud/80 border border-ct-border text-sm font-bold text-ct-slate"
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: Upload,
      title: "AI Document Extraction",
      desc: "Upload a government notice, challan, or ITR acknowledgement. AI extracts ARN, demand amount, reply deadline, and PAN/GSTIN — auto-fills the form. You just review and confirm.",
      color: "bg-ct-saffron/10 text-ct-saffron",
    },
    {
      icon: Brain,
      title: "AI-Native Every Feature",
      desc: "BYOK — bring your own OpenAI, Claude, or Groq key. AI drafts notice replies, generates board reports, answers compliance Q&A on your data. Platform AI cost: zero.",
      color: "bg-purple-100 text-purple-600",
    },
    {
      icon: Bell,
      title: "Never Miss a Deadline",
      desc: "7-day, 3-day, 1-day, and due-date email reminders. Escalation engine notifies department heads and admins automatically. Nothing falls through the cracks.",
      color: "bg-ct-error-light text-ct-error",
    },
    {
      icon: Search,
      title: "Semantic Search (pgvector)",
      desc: 'Ask "find all GST matters related to ITC reversal" — AI returns relevant items even if those exact words don\'t appear. RAG-powered by your own data.',
      color: "bg-ct-info-light text-ct-info",
    },
    {
      icon: Globe,
      title: "Open API & Webhooks",
      desc: "REST API with access codes. Push compliance events to your ERP, Tally, or Zapier. Your ChatGPT Custom GPT can query your live compliance data.",
      color: "bg-ct-teal/10 text-ct-teal",
    },
    {
      icon: CalendarClock,
      title: "Recurring Compliance Engine",
      desc: "Mark GSTR-3B as recurring — system auto-generates next month's filing with the same assignee, GSTIN, and due date. 300+ items managed on autopilot.",
      color: "bg-ct-warning-light text-ct-warning",
    },
  ];

  return (
    <section id="features" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="text-xs font-bold tracking-widest text-ct-saffron uppercase mb-3"
          >
            AI-Powered Features
          </motion.p>
          <motion.h2
            variants={fadeUp}
            custom={1}
            className="font-heading text-3xl md:text-4xl text-ct-navy"
          >
            Not a task list. A Compliance Operating System.
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-4 text-ct-muted max-w-2xl mx-auto text-base"
          >
            Every feature has an AI layer. The platform orchestrates across
            people, tools, and AI agents — so your compliance state is always
            known, always accessible, always actionable.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {features.map((f, i) => (
            <motion.div key={f.title} variants={fadeUp} custom={i}>
              <Card className="rounded-xl shadow-card border-ct-border h-full hover:shadow-md transition-shadow duration-200 group">
                <CardHeader className="pb-3">
                  <div
                    className={`inline-flex size-11 items-center justify-center rounded-xl ${f.color} mb-3`}
                  >
                    <f.icon className="size-5" />
                  </div>
                  <CardTitle className="text-base font-semibold text-ct-navy">
                    {f.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-ct-muted leading-relaxed">
                    {f.desc}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function PenaltyCalculatorSection() {
  const [complianceType, setComplianceType] = useState("GST");
  const [amount, setAmount] = useState("100000");
  const [dueDate, setDueDate] = useState("2026-06-20");
  const [paymentDate, setPaymentDate] = useState("2026-07-15");
  const [showResult, setShowResult] = useState(false);

  const result = useMemo(() => {
    if (!showResult) return null;
    return calculatePenalty(
      complianceType,
      parseFloat(amount) || 0,
      dueDate,
      paymentDate
    );
  }, [complianceType, amount, dueDate, paymentDate, showResult]);

  const rates = PENALTY_RATES[complianceType];

  const handleCalculate = useCallback(() => {
    setShowResult(true);
  }, []);

  return (
    <section
      id="calculator"
      className="py-20 md:py-28 bg-gradient-navy relative overflow-hidden"
    >
      {/* Decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 right-10 size-72 rounded-full bg-ct-saffron/10 blur-3xl" />
        <div className="absolute bottom-10 left-10 size-96 rounded-full bg-ct-teal/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="text-center mb-12"
        >
          <motion.div variants={fadeUp} custom={0}>
            <Badge className="rounded-full bg-ct-saffron/20 text-ct-saffron border-ct-saffron/30 px-4 py-1 text-xs font-medium mb-4">
              <Calculator className="size-3 mr-1.5" />
              #1 Lead Magnet — No Login Required
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            custom={1}
            className="font-heading text-3xl md:text-4xl text-white"
          >
            How much are late filings costing you?
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-4 text-white/60 max-w-xl mx-auto"
          >
            Calculate penalties and interest for delayed GST, TDS, PF, Income
            Tax, and MCA filings. Uses official Indian government rates.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl mx-auto"
        >
          <Card className="rounded-2xl border-white/10 bg-white/5 backdrop-blur-sm shadow-2xl">
            <CardContent className="p-6 md:p-8">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Input Panel */}
                <div className="space-y-5">
                  <div>
                    <Label className="text-xs font-medium text-white/70 mb-1.5 block">
                      Compliance Type
                    </Label>
                    <Select
                      value={complianceType}
                      onValueChange={(v) => {
                        setComplianceType(v);
                        setShowResult(false);
                      }}
                    >
                      <SelectTrigger className="h-11 bg-white/10 border-white/15 text-white rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-ct-navy2 border-white/15">
                        {Object.entries(PENALTY_RATES).map(([key, val]) => (
                          <SelectItem
                            key={key}
                            value={key}
                            className="text-white/90 focus:bg-white/10 focus:text-white"
                          >
                            {val.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-white/70 mb-1.5 block">
                      Tax / Compliance Amount (₹)
                    </Label>
                    <Input
                      type="number"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setShowResult(false);
                      }}
                      placeholder="e.g. 100000"
                      className="h-11 bg-white/10 border-white/15 text-white placeholder:text-white/30 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-white/70 mb-1.5 block">
                        Due Date
                      </Label>
                      <Input
                        type="date"
                        value={dueDate}
                        onChange={(e) => {
                          setDueDate(e.target.value);
                          setShowResult(false);
                        }}
                        className="h-11 bg-white/10 border-white/15 text-white rounded-lg [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-white/70 mb-1.5 block">
                        Actual Filing / Payment Date
                      </Label>
                      <Input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => {
                          setPaymentDate(e.target.value);
                          setShowResult(false);
                        }}
                        className="h-11 bg-white/10 border-white/15 text-white rounded-lg [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  <Button
                    onClick={handleCalculate}
                    className="w-full h-11 bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron rounded-lg text-sm font-semibold"
                  >
                    Calculate Penalty
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                </div>

                {/* Results Panel */}
                <div className="flex flex-col">
                  <div className="rounded-xl bg-white/5 border border-white/10 p-5 flex-1 flex flex-col">
                    <h3 className="text-sm font-semibold text-white/90 mb-4 flex items-center gap-2">
                      <AlertTriangle className="size-4 text-ct-saffron" />
                      Penalty Breakdown
                    </h3>

                    {!result ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                        <div className="size-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                          <IndianRupee className="size-7 text-white/20" />
                        </div>
                        <p className="text-sm text-white/40">
                          Select a compliance type, enter the amount and dates,
                          then click Calculate.
                        </p>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col">
                        <div className="space-y-0">
                          <div className="flex justify-between items-center py-2.5 border-b border-white/10">
                            <span className="text-sm text-white/60">
                              Days Overdue
                            </span>
                            <span className="text-sm font-semibold text-white">
                              {result.daysOverdue} days
                            </span>
                          </div>

                          <div className="flex justify-between items-center py-2.5 border-b border-white/10">
                            <span className="text-sm text-white/60">
                              Interest Rate
                            </span>
                            <span className="text-sm font-semibold text-white">
                              {rates.interestRate}%{" "}
                              {rates.interestPeriod === "monthly"
                                ? "per month"
                                : "per annum"}
                            </span>
                          </div>

                          <div className="flex justify-between items-center py-2.5 border-b border-white/10">
                            <span className="text-sm text-white/60">
                              Interest Amount
                            </span>
                            <span className="text-sm font-semibold text-ct-saffron">
                              {formatINR(result.interestAmount)}
                            </span>
                          </div>

                          {result.penaltyAmount > 0 && (
                            <div className="flex justify-between items-center py-2.5 border-b border-white/10">
                              <span className="text-sm text-white/60">
                                Late Fee / Penalty
                              </span>
                              <span className="text-sm font-semibold text-ct-saffron">
                                {formatINR(result.penaltyAmount)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Total */}
                        <div className="mt-auto pt-5">
                          <div className="rounded-xl bg-ct-error/10 border border-ct-error/20 p-4">
                            <p className="text-[10px] text-ct-error/70 uppercase tracking-wider font-bold mb-1">
                              Total Liability
                            </p>
                            <p className="text-3xl font-bold text-ct-error">
                              {formatINR(result.totalLiability)}
                            </p>
                          </div>
                        </div>

                        {rates.penaltyMax && result.penaltyAmount >= rates.penaltyMax && (
                          <p className="text-[11px] text-white/40 text-center mt-2">
                            Late fee capped at statutory maximum of{" "}
                            {formatINR(rates.penaltyMax)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Rate info bar */}
              <div className="mt-5 flex flex-wrap gap-3 text-[11px] text-white/40">
                <span className="flex items-center gap-1">
                  <FileText className="size-3" />
                  Rates: CBIC / CBDT / EPFO / MCA official notifications
                </span>
                <span className="hidden sm:inline">|</span>
                <span>
                  {complianceType === "GST" && "₹200/day late fee (max ₹5,000) + 18% p.a. interest"}
                  {complianceType === "TDS" && "1.5% per month under Section 201(1A)"}
                  {complianceType === "PF" && "12% per annum interest under Section 7Q"}
                  {complianceType === "INCOME_TAX" && "1% per month under Section 234A/234B/234C"}
                  {complianceType === "MCA" && "₹100/day late fee (max ₹1,00,000) + additional fees per form"}
                  {complianceType === "ESIC" && "12% per annum interest under Section 85B"}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      icon: Upload,
      title: "Upload or Enter",
      desc: "Upload a PDF (notice, challan, certificate) or enter manually. AI reads the document and extracts every field automatically — ARN, amount, deadline, authority, GSTIN.",
    },
    {
      step: "02",
      icon: Brain,
      title: "AI Classifies & Routes",
      desc: "The Groq orchestrator identifies the compliance type, creates or updates the record, calculates deadlines, and routes to the right assignee. All logged in the audit trail.",
    },
    {
      step: "03",
      icon: Bell,
      title: "Remind & Escalate",
      desc: "Automated reminders at 7, 3, and 1 day before deadline. Escalation to department heads and admins if no action. Email + in-app notifications.",
    },
    {
      step: "04",
      icon: Shield,
      title: "Track & Report",
      desc: "Record ARN, challan, and payment proof. Compliance health score (0–100). Board-ready PDF reports. Export to Excel for auditors. Nothing falls through the cracks.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="text-xs font-bold tracking-widest text-ct-teal uppercase mb-3"
          >
            How It Works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            custom={1}
            className="font-heading text-3xl md:text-4xl text-ct-navy"
          >
            From notice PDF to compliance record in 30 seconds
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {steps.map((s, i) => (
            <motion.div key={s.step} variants={fadeUp} custom={i}>
              <div className="relative">
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-10 left-[calc(50%+2rem)] w-[calc(100%-4rem)] h-px border-t-2 border-dashed border-ct-border" />
                )}
                <div className="text-center">
                  <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-ct-saffron/10 mb-4">
                    <s.icon className="size-7 text-ct-saffron" />
                  </div>
                  <div className="text-[10px] font-bold tracking-widest text-ct-muted uppercase mb-2">
                    Step {s.step}
                  </div>
                  <h3 className="font-heading text-lg text-ct-navy mb-2">
                    {s.title}
                  </h3>
                  <p className="text-sm text-ct-muted leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function ComplianceTypesSection() {
  const types = [
    {
      name: "GST",
      items: "GSTR-1, GSTR-3B, GSTR-9, GSTR-9C, ITC-04",
      color: "border-l-ct-saffron",
      bg: "bg-ct-saffron/5",
    },
    {
      name: "TDS / TCS",
      items: "Section 192, 194C, 194I, 194J, 194A, 194H",
      color: "border-l-ct-info",
      bg: "bg-ct-info-light/50",
    },
    {
      name: "Income Tax",
      items: "ITR-1 to ITR-7, Advance Tax, TDS Returns",
      color: "border-l-ct-teal",
      bg: "bg-ct-teal/5",
    },
    {
      name: "MCA / ROC",
      items: "AOC-4, MGT-7, DIR-3 KYC, ADT-1, INC-20A",
      color: "border-l-purple-500",
      bg: "bg-purple-50",
    },
    {
      name: "PF / ESIC",
      items: "Monthly PF, ESI, Half-yearly Returns",
      color: "border-l-ct-warning",
      bg: "bg-ct-warning-light/50",
    },
    {
      name: "Other",
      items: "Labour, Environmental, Professional Tax, State Compliances",
      color: "border-l-ct-slate",
      bg: "bg-ct-cloud/50",
    },
  ];

  return (
    <section id="compliance-types" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="text-xs font-bold tracking-widest text-ct-saffron uppercase mb-3"
          >
            All Indian Compliance
          </motion.p>
          <motion.h2
            variants={fadeUp}
            custom={1}
            className="font-heading text-3xl md:text-4xl text-ct-navy"
          >
            60+ compliance obligations, one platform
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-4 text-ct-muted max-w-2xl mx-auto"
          >
            From GST to MCA, TDS to Environmental — every filing, every
            deadline, every proof of compliance tracked in one place. Entity
            type-based auto-suggestion gets you started in minutes.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {types.map((t, i) => (
            <motion.div
              key={t.name}
              variants={fadeUp}
              custom={i}
              className={`rounded-xl border border-ct-border ${t.bg} p-5 border-l-4 ${t.color} hover:shadow-card transition-shadow`}
            >
              <h3 className="font-semibold text-ct-navy text-sm mb-1.5">
                {t.name}
              </h3>
              <p className="text-xs text-ct-muted leading-relaxed">{t.items}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function OpenPlatformSection() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-xs font-bold tracking-widest text-ct-teal uppercase mb-3"
            >
              Open Platform
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="font-heading text-3xl md:text-4xl text-ct-navy"
            >
              Data in from anywhere. Data out to anything.
            </motion.h2>
            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-4 text-ct-muted leading-relaxed"
            >
              This is not a closed SaaS — it is an operating system. Pull data
              from Tally CSV exports, PDF uploads, manual entry, or inbound
              APIs. Push compliance state to your ERP, CA firm&apos;s system,
              board reporting tools, or your own AI agent via MCP.
            </motion.p>

            <motion.div
              variants={fadeUp}
              custom={3}
              className="mt-8 grid grid-cols-2 gap-4"
            >
              {[
                { label: "Data In", items: "PDF, CSV, API, Webhooks, Email, Manual" },
                { label: "Data Out", items: "REST API, Webhooks, PDF, Excel, MCP" },
              ].map((d) => (
                <div
                  key={d.label}
                  className="rounded-xl bg-white border border-ct-border p-4"
                >
                  <div className="text-[10px] font-bold tracking-widest text-ct-saffron uppercase mb-2">
                    {d.label}
                  </div>
                  <p className="text-sm text-ct-muted">{d.items}</p>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeUp} custom={4} className="mt-6">
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                View API Documentation <ArrowRight className="ml-2 size-4" />
              </Button>
            </motion.div>
          </motion.div>

          {/* Architecture diagram */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6 }}
          >
            <div className="rounded-2xl bg-gradient-navy p-6 md:p-8 text-white">
              <h3 className="font-heading text-xl mb-6">Architecture</h3>
              <div className="space-y-3">
                {[
                  {
                    label: "Your Tools",
                    sub: "Tally, ERP, CA Software, Email",
                    color: "bg-ct-teal/20 border-ct-teal/40",
                  },
                  { label: "↓  Ingest (CSV, PDF, API, Webhook)", color: "border-white/10" },
                  {
                    label: "Veridian AI Engine",
                    sub: "Groq Orchestrator • pgvector • BYOK AI",
                    color: "bg-ct-saffron/20 border-ct-saffron/40",
                  },
                  { label: "↓  RAG + Semantic Search + Auto-Classify", color: "border-white/10" },
                  {
                    label: "Your Outputs",
                    sub: "Board PDF, CA Dashboard, ChatGPT GPT, ERP, MCP",
                    color: "bg-ct-info/20 border-ct-info/40",
                  },
                ].map((item, i) =>
                  item.sub ? (
                    <div
                      key={i}
                      className={`rounded-xl border ${item.color} p-4`}
                    >
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className="text-xs text-white/50 mt-0.5">
                        {item.sub}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={`border-t-2 ${item.color} border-dashed text-center text-xs text-white/30 py-1`}
                    >
                      {item.label}
                    </div>
                  )
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="font-heading text-3xl md:text-5xl text-ct-navy"
          >
            Your compliance score went from{" "}
            <span className="text-ct-error">62</span> to{" "}
            <span className="text-ct-teal">88</span> this quarter.
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={1}
            className="mt-6 text-ct-muted text-lg max-w-2xl mx-auto"
          >
            That is the renewal conversation hook. Start your 14-day free trial
            today — no credit card, full access, set up in 5 minutes.
          </motion.p>
          <motion.div
            variants={fadeUp}
            custom={2}
            className="mt-8 flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              size="lg"
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron h-12 px-10 text-base"
            >
              Start Free Trial
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-ct-navy/20 text-ct-navy hover:bg-ct-cloud h-12 px-10 text-base"
            >
              Book a Demo
            </Button>
          </motion.div>
          <motion.p
            variants={fadeUp}
            custom={3}
            className="mt-6 text-xs text-ct-muted"
          >
            First 200 customers at under ₹5,000/month total infrastructure cost.
            99%+ net margin from day one.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-gradient-navy text-white py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div>
            <div className="mb-4">
              <a href="/" className="flex items-center">
                <Image src="/logo-compact.svg" alt="Veridian AI" width={140} height={28} className="h-7 w-auto brightness-0 invert" unoptimized />
              </a>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">
              The AI-Native Compliance &amp; Audit Operating System. One portal.
              One truth. Built for Indian businesses.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white/70 mb-4">
              Product
            </h4>
            <ul className="space-y-2 text-sm text-white/50">
              <li>
                <a href="#features" className="hover:text-ct-saffron transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#calculator" className="hover:text-ct-saffron transition-colors">
                  Penalty Calculator
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  API Documentation
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  Pricing
                </a>
              </li>
            </ul>
          </div>

          {/* Compliance */}
          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white/70 mb-4">
              Compliance
            </h4>
            <ul className="space-y-2 text-sm text-white/50">
              <li>GST Returns</li>
              <li>TDS / TCS</li>
              <li>Income Tax</li>
              <li>MCA / ROC</li>
              <li>PF / ESIC</li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-bold tracking-widest uppercase text-white/70 mb-4">
              Company
            </h4>
            <ul className="space-y-2 text-sm text-white/50">
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  Blog
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  Contact
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-ct-saffron transition-colors">
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} Veridian AI. All rights
            reserved.
          </p>
          <p className="text-xs text-white/30">
            Built for Indian businesses. AI-Native. Open Platform. Near-Zero
            Cost. <a href="https://verdian-ai.vercel.app" className="hover:text-ct-saffron transition-colors">verdian-ai.vercel.app</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────── MAIN PAGE ──────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-ct-cream">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <TrustBar />
        <FeaturesSection />
        <PenaltyCalculatorSection />
        <HowItWorksSection />
        <ComplianceTypesSection />
        <OpenPlatformSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}