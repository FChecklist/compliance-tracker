"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Bell,
  BarChart3,
  Users,
  Building2,
  CheckCircle2,
  ArrowRight,
  FileText,
  Bot,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Clock,
    title: "Deadline Tracking",
    desc: "Smart pendency tracking across 8 time buckets. Never miss a GST, TDS, or MCA deadline again.",
  },
  {
    icon: Building2,
    title: "Multi-Tenant",
    desc: "Finance, Legal, HR, Operations — each department has its own compliance view and ownership.",
  },
  {
    icon: FileText,
    title: "Audit Trail",
    desc: "Complete change history with timestamps, user identity, and action details. Audit-ready at all times.",
  },
  {
    icon: Bot,
    title: "AI Assistant",
    desc: "Get compliance recommendations, auto-categorize documents, and surface risks before they escalate.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    desc: "Assign owners, departments, and track every action with full audit trails across your team.",
  },
  {
    icon: BarChart3,
    title: "Pendency Dashboard",
    desc: "Real-time overview of overdue, pending, and upcoming compliance items across all departments.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-gradient-navy/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-ct-saffron text-white font-bold text-sm">
              CT
            </div>
            <span className="font-heading text-xl text-white">
              ComplianceTrack
            </span>
          </div>
          <Button
            asChild
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          >
            <Link href="/dashboard">
              Get Started
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative bg-gradient-navy overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 size-72 rounded-full bg-ct-saffron blur-3xl" />
            <div className="absolute bottom-10 right-10 size-96 rounded-full bg-ct-teal blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-ct-saffron/30 bg-ct-saffron/10 px-4 py-1.5 text-sm font-medium text-ct-saffron mb-8">
              <ShieldCheck className="size-4" />
              Compliance Management for Indian Business
            </div>

            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-white leading-tight mb-6">
              One Portal.
              <br />
              <span className="text-ct-saffron">One Truth.</span>
            </h1>

            <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed mb-10">
              Manage every compliance obligation — GST, TDS, MCA, PF, ESIC, Income Tax,
              Labour, Environmental — from a single unified platform built for India.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                asChild
                size="lg"
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-base px-8 h-12 shadow-saffron"
              >
                <Link href="/dashboard">
                  Get Started
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-base px-8 h-12 border-white/20 text-white hover:bg-white/10 hover:text-white"
                onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
              >
                See Features
              </Button>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="bg-ct-cream">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 md:py-24">
            <div className="text-center mb-12">
              <h2 className="font-heading text-3xl sm:text-4xl text-ct-navy mb-3">
                Everything you need to stay compliant
              </h2>
              <p className="text-ct-muted text-lg max-w-xl mx-auto">
                Purpose-built for Indian regulatory requirements with enterprise-grade features.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map((f) => (
                <Card
                  key={f.title}
                  className="border-ct-border shadow-card hover:shadow-nav transition-shadow rounded-xl bg-white"
                >
                  <CardContent className="p-6">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-ct-accent text-ct-saffron mb-4">
                      <f.icon className="size-5" />
                    </div>
                    <h3 className="font-heading text-lg text-ct-navy mb-2">
                      {f.title}
                    </h3>
                    <p className="text-sm text-ct-muted leading-relaxed">
                      {f.desc}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-gradient-navy">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 md:py-20 text-center">
            <h2 className="font-heading text-3xl sm:text-4xl text-white mb-4">
              Ready to take control of compliance?
            </h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto mb-8">
              Join hundreds of organisations already using ComplianceTrack to stay audit-ready.
            </p>
            <Button
              asChild
              size="lg"
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-base px-8 h-12 shadow-saffron"
            >
              <Link href="/dashboard">
                Open Dashboard
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-ct-border bg-ct-cream py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-ct-muted">
          <span>&copy; 2025 ComplianceTrack. Built for Indian compliance.</span>
          <span>One Portal. One Truth.</span>
        </div>
      </footer>
    </div>
  );
}