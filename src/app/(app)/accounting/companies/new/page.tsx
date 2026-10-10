"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 16 of 24:
// port of PROJEXA's own CompanyCreateClient.tsx -- a real create screen for
// erp_companies (legal entity / office within an org's ERP, distinct from
// the org/tenant itself). POSTs to the SAME POST /api/v1/projexa/companies
// this app's backend already serves (createCompany in
// erp-company-service.ts, CompanyInput = { companyName, abbr,
// parentCompanyId, isGroup, defaultCurrencyId, country,
// dateOfIncorporation }) -- zero new backend route. That route requires
// requireRoleOrScope(ctx, "manager", "write") -- a lower-privileged user
// gets an honest 403 surfaced via toast, same as every other ported module.
//
// Rebuilt on this repo's own Card/Input/Select (matching
// src/app/(app)/accounting/page.tsx and src/app/(app)/invoices/new/
// page.tsx), not PROJEXA's @fchecklist/veridian-ui-kit ObjectScreen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Company = { id: string; companyName: string };
const NO_PARENT = "__none__";

export default function CompanyNewPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [country, setCountry] = useState("");
  const [parentCompanyId, setParentCompanyId] = useState<string>(NO_PARENT);
  const [isGroup, setIsGroup] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/projexa/companies")
      .then((r) => r.json())
      .then((data) => setCompanies(data.companies ?? []))
      .catch(() => {});
  }, []);

  async function createCompany() {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/projexa/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          abbr: abbr || undefined,
          country: country || undefined,
          parentCompanyId: parentCompanyId === NO_PARENT ? undefined : parentCompanyId,
          isGroup,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create company");
      toast.success("Company created");
      router.push("/accounting?tab=companies");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">New Company / Office</h1>
        <p className="text-sm text-ct-muted mt-1">Accounting / New Company</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Company Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Company Name</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Interiors — Mumbai Office" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Abbreviation</Label>
              <Input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="e.g. AIM" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. India" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Parent Company (optional)</Label>
            <Select value={parentCompanyId} onValueChange={setParentCompanyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>None (top-level company)</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-ct-muted">
            <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} className="size-4" />
            This is a group/holding entity (organizational grouping, not its own set of postings)
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/accounting?tab=companies")} disabled={submitting}>Cancel</Button>
        <Button
          className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
          onClick={createCompany}
          disabled={submitting || !companyName.trim()}
        >
          {submitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {submitting ? "Creating..." : "Create Company"}
        </Button>
      </div>
    </div>
  );
}
