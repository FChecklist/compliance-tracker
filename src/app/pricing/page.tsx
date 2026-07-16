"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Check,
  X,
  ArrowRight,
  Sparkles,
  Zap,
  Building2,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ─────────────────────────── DATA ─────────────────────────── */

const PLANS = [
  {
    name: "Starter",
    priceMonthly: 0,
    priceAnnual: 0,
    description: "Perfect for small teams getting started with compliance tracking.",
    icon: Zap,
    popular: false,
    cta: "Start Free Trial",
    ctaLink: "/signup",
    features: [
      "Up to 3 users",
      "50 compliance items",
      "Basic dashboard",
      "Email notifications",
      "Community support",
    ],
  },
  {
    name: "Professional",
    priceMonthly: 2499,
    priceAnnual: 24999,
    description: "For growing businesses that need AI-powered compliance.",
    icon: Sparkles,
    popular: true,
    cta: "Start 14-Day Trial",
    ctaLink: "/signup",
    features: [
      "Up to 15 users",
      "Unlimited compliance items",
      "AI document extraction",
      "Advanced reports",
      "API access",
      "Priority support",
      "Bulk import",
    ],
  },
  {
    name: "Enterprise",
    priceMonthly: 0,
    priceAnnual: 0,
    description: "For large organisations with complex compliance needs.",
    icon: Building2,
    popular: false,
    cta: "Contact Sales",
    ctaLink: "/signup",
    features: [
      "Unlimited users",
      "Multi-GSTIN support",
      "Dedicated account manager",
      "Custom integrations",
      "SSO / SAML",
      "SLA guarantee",
    ],
  },
];

const COMPARISON_FEATURES = [
  { feature: "Users", starter: "Up to 3", professional: "Up to 15", enterprise: "Unlimited" },
  { feature: "Compliance Items", starter: "50", professional: "Unlimited", enterprise: "Unlimited" },
  { feature: "AI Document Extraction", starter: false, professional: true, enterprise: true },
  { feature: "AI Q&A & Drafting", starter: false, professional: true, enterprise: true },
  { feature: "Semantic Search", starter: false, professional: true, enterprise: true },
  { feature: "Basic Dashboard", starter: true, professional: true, enterprise: true },
  { feature: "Advanced Reports & Analytics", starter: false, professional: true, enterprise: true },
  { feature: "API Access", starter: false, professional: true, enterprise: true },
  { feature: "Bulk CSV Import", starter: false, professional: true, enterprise: true },
  { feature: "Webhook Integrations", starter: false, professional: false, enterprise: true },
  { feature: "Multi-GSTIN", starter: false, professional: false, enterprise: true },
  { feature: "SSO / SAML", starter: false, professional: false, enterprise: true },
  { feature: "Dedicated Account Manager", starter: false, professional: false, enterprise: true },
  { feature: "SLA Guarantee", starter: false, professional: false, enterprise: true },
  { feature: "Email Notifications", starter: true, professional: true, enterprise: true },
  { feature: "Priority Support", starter: false, professional: true, enterprise: true },
  { feature: "Community Support", starter: true, professional: true, enterprise: true },
  { feature: "BYOK AI Keys", starter: false, professional: true, enterprise: true },
];

const FAQS = [
  {
    q: "Can I change my plan later?",
    a: "Absolutely. You can upgrade or downgrade your plan at any time from your account settings. When upgrading, you'll be charged the prorated difference for the remainder of your billing cycle. When downgrading, the change takes effect at the start of your next billing period, and you'll retain access to your current plan features until then.",
  },
  {
    q: "What happens when my 14-day trial ends?",
    a: "When your Professional trial ends, your account automatically switches to the free Starter plan. None of your data is lost — your compliance items, documents, and team members remain intact. You can upgrade to Professional at any time to regain access to AI features, advanced reports, and API access.",
  },
  {
    q: "Is my data secure on VERIDIAN AI?",
    a: "Yes. All data is encrypted in transit and at rest by our infrastructure providers. VERIDIAN AI is hosted on Vercel and Supabase, both of which hold current SOC 2 Type II certifications, and tenant data is additionally isolated at the database layer via row-level security. Your AI keys (if using BYOK) are encrypted separately and never shared with any third party. VERIDIAN AI itself does not currently hold a SOC 2 certification or an independent penetration-test report — if your organisation needs either for a vendor security review, contact our sales team to discuss your requirements.",
  },
  {
    q: "Do you offer discounts for NGOs or startups?",
    a: "Yes! We offer a 50% discount on the Professional plan for registered NGOs, educational institutions, and early-stage startups (under 2 years old, with fewer than 10 employees). Contact our sales team with your registration certificate to get started.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit and debit cards, UPI, net banking, and bank transfers. For Enterprise plans, we also support purchase orders and annual invoicing. Our sales team will set up billing with you directly when you sign up.",
  },
];

/* ─────────────────────────── ANIMATION VARIANTS ─────────────────────────── */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

/* ─────────────────────────── COMPONENT ─────────────────────────── */

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);

  return (
    <div className="min-h-screen bg-ct-cream">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg shadow-nav">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-ct-saffron flex items-center justify-center">
              <span className="text-white font-bold text-sm">V</span>
            </div>
            <span className="font-heading text-xl text-ct-navy">VERIDIAN AI</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-ct-slate text-sm">
                Log in
              </Button>
            </Link>
            <Link href="/signup">
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron text-sm">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-16 pb-10 text-center px-4">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={0}
        >
          <Badge className="bg-ct-accent text-ct-saffron text-xs font-semibold mb-4 px-3 py-1">
            <Sparkles className="size-3 mr-1.5" />
            Pricing
          </Badge>
        </motion.div>
        <motion.h1
          className="font-heading text-3xl sm:text-4xl lg:text-5xl text-ct-navy text-balance max-w-2xl mx-auto"
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={1}
        >
          Simple, Transparent Pricing
        </motion.h1>
        <motion.p
          className="text-ct-muted text-base sm:text-lg mt-4 max-w-lg mx-auto text-balance"
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={2}
        >
          Start free. Scale as you grow.
        </motion.p>

        {/* Annual / Monthly Toggle */}
        <motion.div
          className="flex items-center justify-center gap-3 mt-8"
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={3}
        >
          <Label
            htmlFor="billing-toggle"
            className={`text-sm font-medium transition-colors ${!annual ? "text-ct-navy" : "text-ct-muted"}`}
          >
            Monthly
          </Label>
          <Switch
            id="billing-toggle"
            checked={annual}
            onCheckedChange={setAnnual}
            className="data-[state=checked]:bg-ct-saffron"
          />
          <Label
            htmlFor="billing-toggle"
            className={`text-sm font-medium transition-colors ${annual ? "text-ct-navy" : "text-ct-muted"}`}
          >
            Annual
          </Label>
          {annual && (
            <Badge className="bg-ct-teal text-white text-[10px] font-semibold ml-1">
              Save 20%
            </Badge>
          )}
        </motion.div>
      </section>

      {/* ── Pricing Cards ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={i + 4}
              className={plan.popular ? "md:-mt-4 md:mb-0" : ""}
            >
              <Card
                className={`rounded-xl shadow-card bg-white relative overflow-hidden ${
                  plan.popular ? "border-2 border-ct-saffron shadow-saffron" : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute top-0 left-0 right-0 bg-ct-saffron text-white text-xs font-bold text-center py-1.5">
                    Most Popular
                  </div>
                )}
                <CardHeader className={`pb-4 ${plan.popular ? "pt-10" : ""}`}>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`size-10 rounded-xl flex items-center justify-center ${
                        plan.popular ? "bg-ct-saffron/10" : "bg-ct-cloud"
                      }`}
                    >
                      <plan.icon
                        className={`size-5 ${
                          plan.popular ? "text-ct-saffron" : "text-ct-slate"
                        }`}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-semibold text-ct-navy">
                        {plan.name}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    {plan.name === "Enterprise" ? (
                      <p className="font-heading text-4xl text-ct-navy">Custom</p>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-ct-muted text-sm">₹</span>
                        <span className="font-heading text-4xl text-ct-navy">
                          {annual ? plan.priceAnnual.toLocaleString("en-IN") : plan.priceMonthly.toLocaleString("en-IN")}
                        </span>
                        <span className="text-ct-muted text-sm">
                          {plan.priceAnnual > 0
                            ? annual
                              ? "/year"
                              : "/month"
                            : ""}
                        </span>
                      </div>
                    )}
                    <p className="text-sm text-ct-muted mt-2">{plan.description}</p>
                  </div>

                  <Link href={plan.ctaLink} className="block">
                    <Button
                      className={`w-full text-sm font-semibold ${
                        plan.popular
                          ? "bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                          : "bg-ct-navy hover:bg-ct-navy2 text-white"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="size-4 ml-2" />
                    </Button>
                  </Link>

                  <div className="space-y-3">
                    {plan.features.map((f) => (
                      <div key={f} className="flex items-center gap-2.5 text-sm">
                        <Check className="size-4 text-ct-teal shrink-0" />
                        <span className="text-ct-slate">{f}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Feature Comparison Table ── */}
      <section className="bg-white py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.div
            className="text-center mb-10"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="font-heading text-2xl sm:text-3xl text-ct-navy text-balance">
              Compare Plans
            </h2>
            <p className="text-ct-muted mt-2 text-sm">
              A detailed breakdown of what&apos;s included in each plan
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={1}
            className="overflow-x-auto"
          >
            <Table>
              <TableHeader>
                <TableRow className="border-ct-border hover:bg-transparent">
                  <TableHead className="text-xs font-semibold text-ct-muted uppercase w-[40%]">
                    Feature
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-ct-muted uppercase text-center">
                    Starter
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-ct-saffron uppercase text-center">
                    Professional
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-ct-muted uppercase text-center">
                    Enterprise
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON_FEATURES.map((row) => (
                  <TableRow key={row.feature} className="border-ct-border hover:bg-ct-row-hover">
                    <TableCell className="text-sm text-ct-navy font-medium py-3">
                      {row.feature}
                    </TableCell>
                    {(["starter", "professional", "enterprise"] as const).map(
                      (plan) => {
                        const val = row[plan];
                        return (
                          <TableCell
                            key={plan}
                            className="text-center py-3"
                          >
                            {typeof val === "boolean" ? (
                              val ? (
                                <Check className="size-4 text-ct-teal mx-auto" />
                              ) : (
                                <X className="size-4 text-ct-border2 mx-auto" />
                              )
                            ) : (
                              <span className="text-sm text-ct-slate">{val}</span>
                            )}
                          </TableCell>
                        );
                      }
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        </div>
      </section>

      {/* ── FAQ Section ── */}
      <section className="py-20 px-4 bg-ct-cream">
        <div className="max-w-3xl mx-auto">
          <motion.div
            className="text-center mb-10"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={0}
          >
            <div className="inline-flex items-center justify-center size-12 rounded-xl bg-ct-accent mb-4">
              <HelpCircle className="size-6 text-ct-saffron" />
            </div>
            <h2 className="font-heading text-2xl sm:text-3xl text-ct-navy">
              Frequently Asked Questions
            </h2>
            <p className="text-ct-muted mt-2 text-sm">
              Everything you need to know about our plans
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            custom={1}
          >
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-2 sm:p-4">
                <Accordion type="single" collapsible className="w-full">
                  {FAQS.map((faq, i) => (
                    <AccordionItem
                      key={i}
                      value={`faq-${i}`}
                      className="border-ct-border px-2 sm:px-4"
                    >
                      <AccordionTrigger className="text-sm sm:text-base font-medium text-ct-navy hover:no-underline">
                        {faq.q}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-ct-muted leading-relaxed">
                        {faq.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* ── Bottom CTA Banner ── */}
      <section className="py-20 px-4">
        <motion.div
          className="max-w-4xl mx-auto rounded-2xl bg-gradient-navy p-8 sm:p-12 text-center relative overflow-hidden"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          custom={0}
        >
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-ct-saffron blur-[80px]" />
            <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-ct-teal blur-[60px]" />
          </div>
          <div className="relative z-10">
            <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl text-white text-balance">
              Ready to streamline your compliance?
            </h2>
            <p className="text-ct-cloud2 mt-4 text-sm sm:text-base max-w-lg mx-auto text-balance">
              Join thousands of Indian businesses that trust VERIDIAN AI to never miss a deadline.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
              <Link href="/signup">
                <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron text-sm font-semibold px-6">
                  Start Free Trial
                  <ArrowRight className="size-4 ml-2" />
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="border-ct-cloud2 text-white hover:bg-white/10 text-sm"
                >
                  Log in
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-ct-border py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-ct-muted">
          <p>&copy; {new Date().getFullYear()} VERIDIAN AI. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-ct-navy transition-colors">
              Home
            </Link>
            <Link href="/pricing" className="hover:text-ct-navy transition-colors">
              Pricing
            </Link>
            <Link href="/login" className="hover:text-ct-navy transition-colors">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}