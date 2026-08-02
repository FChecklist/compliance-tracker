"use client";

// Priority 17 remaining gap (2026-07-16): compliance-tracker had zero
// EXTRACTED company/office selector component -- the only real precedent was
// an inline copy in src/app/(app)/erp/reports/page.tsx (its own local
// `companies`/`companyId`/`consolidate` state + a hand-rolled <Select>).
// PROJEXA already extracted this exact pattern into its own
// src/components/company-scope.tsx (Priority 17 Wave 1) for reuse across
// Leads/Employees/Leave/Budgets there -- this is compliance-tracker's own
// equivalent, built fresh since PR #342/#365 never added one here, following
// the same shape so a future pass can converge them if desired. Fetches the
// org's real erp_companies rows via the existing GET /api/erp/companies
// route (erp-company-service.ts#listCompanies) -- no new backend surface.
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";

export type Company = { id: string; companyName: string; abbr: string | null; isGroup: boolean };

/**
 * Fetches the org's companies once, only when `enabled` is true -- callers
 * pass `entry.supportsCompanyScope` here so the ~200-entry catalog doesn't
 * fire a companies fetch for every card, only the ones that can actually use
 * it. Returns [] (not an error) for orgs with no erp_companies rows --
 * callers hide the selector entirely when this is empty, matching PROJEXA's
 * company-scope.tsx convention.
 */
export function useCompanies(enabled: boolean): Company[] {
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    if (!enabled) return;
    fetch("/api/erp/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(Array.isArray(d.companies) ? d.companies : []))
      .catch(() => {});
  }, [enabled]);
  return companies;
}

export function CompanySelector({
  companies,
  companyId,
  onChange,
}: {
  companies: Company[];
  companyId: string | null;
  onChange: (companyId: string | null) => void;
}) {
  if (companies.length === 0) return null;
  return (
    <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-2">
      <Building2 className="mb-2 size-4 text-ct-muted" />
      <div className="space-y-1">
        <Label className="text-xs">Company / Office</Label>
        <Select value={companyId ?? "__all__"} onValueChange={(v) => onChange(v === "__all__" ? null : v)}>
          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All companies (org-wide)</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
