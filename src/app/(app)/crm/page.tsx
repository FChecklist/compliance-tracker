"use client";

export const dynamic = "force-dynamic";

// Wave 3 (2026-07-21) refactor: this page used to cram both the full Leads
// and Opportunities management UI into two tabs, fetched unpaginated, with
// no detail pages underneath. That's exactly the "lacks fineness" gap the
// Owner flagged. All of that functionality now lives on its own dedicated,
// paginated page (crm/leads, crm/opportunities/[id], crm/contacts,
// crm/accounts -- the last one already existed from Wave B). This page is
// now what it should have been from the start: a real overview/dashboard
// -- headline counts + AI-attention items -- with clear links into each
// module, matching how crm/accounts already stood on its own.
import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, Target, Building2, Users, Megaphone, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Counts = { leads: number; opportunities: number; accounts: number; contacts: number; campaigns: number };

const MODULES = [
  { key: "leads", href: "/crm/leads", label: "Leads", icon: UserPlus, description: "Prospects not yet a client" },
  { key: "opportunities", href: "/crm/opportunities", label: "Opportunities", icon: Target, description: "Deals in progress, tracked stage by stage" },
  { key: "accounts", href: "/crm/accounts", label: "Accounts", icon: Building2, description: "Company-level records and subsidiary hierarchy" },
  { key: "contacts", href: "/crm/contacts", label: "Contacts", icon: Users, description: "Every named person across your account book" },
  { key: "campaigns", href: "/crm/campaigns", label: "Campaigns", icon: Megaphone, description: "Marketing efforts leads can be attributed to" },
] as const;

export default function CrmPage() {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/crm/leads?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/opportunities?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/accounts?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/contacts?pageSize=1").then((r) => r.json()),
      fetch("/api/crm/campaigns").then((r) => r.json()),
    ]).then(([leads, opportunities, accounts, contacts, campaigns]) => {
      setCounts({
        leads: leads.total ?? 0,
        opportunities: opportunities.total ?? 0,
        accounts: accounts.total ?? 0,
        contacts: contacts.total ?? 0,
        campaigns: Array.isArray(campaigns) ? campaigns.length : 0,
      });
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy flex items-center gap-2"><Sparkles className="size-5 text-ct-saffron" /> CRM</h1>
        <p className="text-sm text-ct-muted mt-1">Lead-to-client pipeline -- how you actually get a new client, and keep the ones you have.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.key} href={m.href}>
              <Card className="rounded-xl shadow-card bg-white hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="grid place-items-center size-9 rounded-lg bg-ct-saffron/10"><Icon className="size-4.5 text-ct-saffron" /></div>
                    <span className="text-2xl font-heading text-ct-navy">{counts ? counts[m.key as keyof Counts] : "—"}</span>
                  </div>
                  <p className="text-sm font-semibold text-ct-navy">{m.label}</p>
                  <p className="text-xs text-ct-muted">{m.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
