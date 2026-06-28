import {
  ShieldCheck,
  Bell,
  BarChart3,
  Users,
  Building2,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Universal Compliance",
    desc: "GST, TDS, MCA, PF, ESIC, POSH — track every compliance type from a single portal.",
  },
  {
    icon: Bell,
    title: "Never Miss a Deadline",
    desc: "Smart reminders across 8 time buckets: 24h, 7d, 30d, 60d, 90d, 180d, 365d.",
  },
  {
    icon: BarChart3,
    title: "Pendency Dashboard",
    desc: "Real-time overview of overdue, pending, and upcoming compliance items.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    desc: "Assign owners, departments, and track every action with full audit trails.",
  },
  {
    icon: Building2,
    title: "Multi-Department",
    desc: "Finance, Legal, HR, IT, Operations — each department has its own view.",
  },
  {
    icon: CheckCircle2,
    title: "Audit Ready",
    desc: "Complete change history with timestamps, user identity, and IP tracking.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50/50 to-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <ShieldCheck className="size-4" />
            </div>
            <span className="font-bold text-lg text-foreground">
              ComplianceTrack
            </span>
          </div>
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/dashboard">
              Go to Dashboard
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700 mb-6">
            <ShieldCheck className="size-4" />
            Compliance Management for the AI Era
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground max-w-3xl mx-auto leading-tight">
            One Portal.
            <br />
            <span className="text-emerald-600">One Truth.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Manage every compliance obligation — IT, tax, legal, regulatory,
            operational, environmental — from a single unified platform. Never
            miss a deadline again.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              asChild
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-base px-8"
            >
              <Link href="/dashboard">
                Open Dashboard
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="text-base px-8">
              Learn More
            </Button>
          </div>
        </section>

        {/* Features Grid */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
          <h2 className="text-2xl font-bold text-center mb-10">
            Everything you need to stay compliant
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <Card
                key={f.title}
                className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow"
              >
                <CardContent className="p-6">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 mb-4">
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Social Proof */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 text-center">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Built for
            </p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-muted-foreground/70">
              {[
                "Chartered Accountants",
                "Audit Firms",
                "CFOs",
                "HR Managers",
                "Company Secretaries",
                "IT Teams",
                "Operations Heads",
              ].map((role) => (
                <span key={role} className="text-sm font-medium">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} ComplianceTrack. All rights reserved.</span>
          <span>One Portal. One Truth.</span>
        </div>
      </footer>
    </div>
  );
}