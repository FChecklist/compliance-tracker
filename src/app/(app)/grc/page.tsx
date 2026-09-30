"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module 21 of 24:
// port of PROJEXA's own GRC (Governance, Risk & Compliance) module
// (src/app/(app)/grc/page.tsx + GrcClient.tsx there -- 8 tabs: Dashboard,
// Risk Register, Audits & Findings, Policies, Vendor Risk, Fraud &
// Incidents, Access Review, Compliance Register). Every tab reads an
// already-native /api/v1/projexa/* route -- zero new backend route, zero
// HTTP hop to a separate origin -- verified field-for-field against each
// route.ts and its service function (risk-register-service.ts's
// listRisks/getRisk/updateRiskStatus/listAuditEngagements/
// createAuditEngagement/createAuditFinding/advanceAuditFindingCapaStatus/
// listPolicies/getPolicy/updatePolicy/listVendorRiskProfiles/
// createVendorRiskProfile/getGrcDashboard, fraud-case-service.ts's
// listFraudCases/getFraudCase/updateFraudCaseStatus,
// access-review-service.ts's listAccessReviewCycles/
// getAccessReviewCycleDetail/reviewCertification, compliance-service.ts's
// listComplianceItems) before writing this file:
//   GET  /api/v1/projexa/grc-dashboard        -> getGrcDashboard (unwrapped)
//   GET  /api/v1/projexa/risks                -> listRisks ({risks,totalCount,hiddenByScope})
//   PATCH /api/v1/projexa/risks/[id]          -> updateRiskStatus ({status})
//   GET  /api/v1/projexa/audit-engagements    -> listAuditEngagements ({engagements}, findings embedded)
//   PATCH /api/v1/projexa/audit-findings/[id] -> advanceAuditFindingCapaStatus (no body, cycles CAPA forward)
//   GET  /api/v1/projexa/policies             -> listPolicies ({policies})
//   PATCH /api/v1/projexa/policies/[id]       -> updatePolicy ({action:"request_publish"})
//   GET  /api/v1/projexa/vendor-risk          -> listVendorRiskProfiles ({vendors})
//   GET  /api/v1/projexa/fraud-cases          -> listFraudCases ({cases})
//   PATCH /api/v1/projexa/fraud-cases/[id]    -> updateFraudCaseStatus ({status})
//   GET  /api/v1/projexa/access-review        -> listAccessReviewCycles ({cycles})
//   GET  /api/v1/projexa/compliance-register  -> listComplianceItems ({register,total,page,limit,totalPages})
// One real contract difference from PROJEXA's own client code, found by
// reading the actual route (not assumed): PROJEXA's own /api/access-review
// cycle-detail read returns the cycle object directly, but this repo's
// GET /api/v1/projexa/access-review?cycleId= wraps it as {cycle: detail} --
// handled in the [id] object page, not here.
//
// UI is compliance-tracker's own shadcn Tabs/Table/Card/Select (house
// convention -- see src/app/(app)/accounting/page.tsx, module 16/24, the
// closest-shaped precedent: same tabbed dashboard, same fetchOk/formatDate/
// money helpers, same ?tab= URL-synced pattern), not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame/GrcClient/ObjectScreen.
//
// Org-wide, not project-scoped -- every route above reads only ctx.orgId,
// no projectId anywhere in the risk-register/fraud-case/access-review/
// compliance-service surfaces, so no ProjectPicker/NoProjectsCard needed
// (same as finance/budgets, module 20/24).
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, ShieldAlert, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

// ---------------------------------------------------------------------------
// Shared types -- field-for-field from the route.ts/service-function bodies
// cited above, not from PROJEXA's own client-side assumptions.
// ---------------------------------------------------------------------------
type Risk = { id: string; title: string; category: string; likelihood: number; impact: number; severity: string; status: string; ownerDept: string | null };
type GrcDashboard = {
  risks: { openCount: number; totalCount: number; byCategory: Record<string, number>; bySeverity: Record<string, number>; heatmap: { likelihood: number; impact: number; count: number }[] };
  audit: { engagementCount: number; openFindingsCount: number; overdueFindingsCount: number };
  policies: { totalCount: number; draftCount: number; underReviewCount: number; publishedCount: number };
  vendorRisk: { totalCount: number; highTierCount: number };
};
type AuditFinding = { id: string; title: string; severity: string; capaStatus: string; dueDate: string | null; retestResult: string | null };
type AuditEngagement = { id: string; name: string; auditType: string; status: string; findings: AuditFinding[] };
type Policy = { id: string; title: string; category: string; version: string; status: string; attestationRate: number | null };
type VendorRiskProfile = { id: string; name: string; riskTier: string; riskScore: number | null };
type FraudCase = { id: string; caseNumber: number; title: string; status: string; fraudType: string; financialExposure: string | null; reportedDate: string };
type AccessReviewCycle = { id: string; name: string; status: string; dueDate: string | null; completedAt: string | null };
type ComplianceItem = { id: string; title: string; complianceType: string; status: string; priority: string; dueDate: string; department: { name: string } | null };

const VALID_TABS = new Set(["dashboard", "risks", "audits", "policies", "vendor-risk", "fraud", "access-review", "compliance"]);
const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { low: "outline", medium: "secondary", high: "destructive" };
const RISK_STATUS_FLOW: Record<string, string> = { open: "mitigating", mitigating: "closed", closed: "closed" };
const FRAUD_TRANSITIONS: Record<string, string[]> = {
  reported: ["investigating"], investigating: ["confirmed", "unsubstantiated"], confirmed: ["resolved"], unsubstantiated: ["resolved"], resolved: [],
};

async function fetchOk<T>(url: string, what: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load ${what} (HTTP ${res.status})`);
  return body as T;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------
function DashboardPanel() {
  const [data, setData] = useState<GrcDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchOk<GrcDashboard>("/api/v1/projexa/grc-dashboard", "the GRC dashboard"));
      setLoadError(null);
    } catch (err) {
      setData(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the GRC dashboard");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;
  if (loadError || !data) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted space-y-3">
          <p role="alert">{loadError ?? "Couldn't load the GRC dashboard."}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const maxHeat = Math.max(1, ...data.risks.heatmap.map((h) => h.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">Open Risks</p><p className="mt-1 text-2xl font-bold text-ct-navy">{data.risks.openCount}</p><p className="text-xs text-ct-muted">of {data.risks.totalCount} total</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">Open Findings</p><p className="mt-1 text-2xl font-bold text-ct-navy">{data.audit.openFindingsCount}</p><p className="text-xs text-red-600">{data.audit.overdueFindingsCount} overdue</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">Policies Published</p><p className="mt-1 text-2xl font-bold text-ct-navy">{data.policies.publishedCount}</p><p className="text-xs text-ct-muted">{data.policies.underReviewCount} under review</p></CardContent></Card>
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4"><p className="text-xs font-medium text-ct-muted uppercase">High-Risk Vendors</p><p className="mt-1 text-2xl font-bold text-ct-navy">{data.vendorRisk.highTierCount}</p><p className="text-xs text-ct-muted">of {data.vendorRisk.totalCount} tracked</p></CardContent></Card>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base text-ct-navy">Risk Heatmap (Likelihood x Impact)</CardTitle></CardHeader>
        <CardContent>
          {data.risks.heatmap.length === 0 ? (
            <p className="py-6 text-center text-sm text-ct-muted">No open risks logged yet.</p>
          ) : (
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 5 }, (_, i) => 5 - i).map((impact) => (
                <div key={impact} className="contents">
                  {Array.from({ length: 5 }, (_, j) => j + 1).map((likelihood) => {
                    const cell = data.risks.heatmap.find((h) => h.likelihood === likelihood && h.impact === impact);
                    const count = cell?.count ?? 0;
                    const intensity = count / maxHeat;
                    return (
                      <div
                        key={`${likelihood}-${impact}`}
                        className="flex aspect-square items-center justify-center rounded text-xs font-semibold"
                        style={{ backgroundColor: count === 0 ? "var(--muted)" : `rgba(220, 38, 38, ${0.15 + intensity * 0.65})`, color: intensity > 0.5 ? "white" : undefined }}
                        title={`Likelihood ${likelihood} x Impact ${impact}: ${count} risk(s)`}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-ct-muted">Rows: impact 5 (top) to 1 (bottom). Columns: likelihood 1 to 5.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Risks by Category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.risks.byCategory).length === 0 ? <p className="text-sm text-ct-muted">No open risks.</p> : Object.entries(data.risks.byCategory).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between text-sm"><span className="capitalize text-ct-navy">{cat}</span><Badge variant="outline">{count}</Badge></div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader><CardTitle className="text-base text-ct-navy">Risks by Severity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.risks.bySeverity).map(([sev, count]) => (
              <div key={sev} className="flex items-center justify-between text-sm"><span className="capitalize text-ct-navy">{sev}</span><Badge variant={SEVERITY_VARIANT[sev] ?? "outline"}>{count}</Badge></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Register tab
// ---------------------------------------------------------------------------
function RiskRegisterPanel() {
  const router = useRouter();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ risks?: Risk[] }>("/api/v1/projexa/risks", "the risk register");
      setRisks(data.risks ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load risk register");
      setRisks([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function advanceStatus(risk: Risk) {
    const nextStatus = RISK_STATUS_FLOW[risk.status];
    if (nextStatus === risk.status) return;
    try {
      await fetchOk(`/api/v1/projexa/risks/${risk.id}`, "the risk status", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }),
      });
      void load();
    } catch {
      // fetchOk already surfaced an error object; the table simply won't advance.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/risks/new")}><Plus className="size-4" /> Log Risk</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <div className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
          ) : risks.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No risks logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Likelihood x Impact</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {risks.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/grc/risks/${r.id}`)}>
                    <TableCell className="font-medium text-ct-navy">{r.title}</TableCell>
                    <TableCell className="capitalize text-ct-muted">{r.category}</TableCell>
                    <TableCell className="text-ct-muted">{r.likelihood} x {r.impact} = {r.likelihood * r.impact}</TableCell>
                    <TableCell><Badge variant={SEVERITY_VARIANT[r.severity] ?? "outline"} className="capitalize">{r.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {r.status !== "closed" && (
                        <Button variant="ghost" size="sm" onClick={() => advanceStatus(r)}>
                          Move to {RISK_STATUS_FLOW[r.status]} <ChevronRight className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audits & Findings tab
// ---------------------------------------------------------------------------
function AuditsPanel() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<AuditEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ engagements?: AuditEngagement[] }>("/api/v1/projexa/audit-engagements", "audit engagements");
      setEngagements(data.engagements ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load audit engagements");
      setEngagements([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function advanceCapa(findingId: string) {
    try {
      await fetchOk(`/api/v1/projexa/audit-findings/${findingId}`, "the CAPA status", { method: "PATCH" });
      void load();
    } catch {
      // best-effort refresh; error already thrown from fetchOk
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => router.push("/grc/findings/new")}>Record Finding</Button>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/audits/new")}><Plus className="size-4" /> Plan Audit</Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : loadError ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></CardContent></Card>
      ) : engagements.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No audit engagements planned yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {engagements.map((e) => (
            <Card key={e.id} className="rounded-xl shadow-card bg-white">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base text-ct-navy">{e.name}</CardTitle>
                  <p className="text-xs capitalize text-ct-muted">{e.auditType} audit &middot; {e.status}</p>
                </div>
                <Badge variant="outline">{e.findings.length} finding{e.findings.length === 1 ? "" : "s"}</Badge>
              </CardHeader>
              {e.findings.length > 0 && (
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Severity</TableHead><TableHead>CAPA Status</TableHead><TableHead>Due</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {e.findings.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell>{f.title}</TableCell>
                          <TableCell><Badge variant={SEVERITY_VARIANT[f.severity] ?? "outline"} className="capitalize">{f.severity}</Badge></TableCell>
                          <TableCell><Badge variant={f.capaStatus === "closed" ? "default" : "outline"} className="capitalize">{f.capaStatus.replace("_", " ")}</Badge></TableCell>
                          <TableCell className="text-ct-muted">{f.dueDate ? formatDate(f.dueDate) : "—"}</TableCell>
                          <TableCell className="text-right">
                            {f.capaStatus !== "closed" && <Button variant="ghost" size="sm" onClick={() => advanceCapa(f.id)}>Advance CAPA <ChevronRight className="size-3.5" /></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policies tab
// ---------------------------------------------------------------------------
function PoliciesPanel() {
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ policies?: Policy[] }>("/api/v1/projexa/policies", "policies");
      setPolicies(data.policies ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load policies");
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function requestPublish(id: string) {
    try {
      await fetchOk(`/api/v1/projexa/policies/${id}`, "the publish request", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }),
      });
      void load();
    } catch {
      // best-effort refresh; error already thrown from fetchOk
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/policies/new")}><Plus className="size-4" /> Draft Policy</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <div className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
          ) : policies.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No policies drafted yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Attestation</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/grc/policies/${p.id}`)}>
                    <TableCell className="font-medium text-ct-navy">{p.title}</TableCell>
                    <TableCell className="capitalize text-ct-muted">{p.category.replace("_", " ")}</TableCell>
                    <TableCell className="text-ct-muted">{p.version}</TableCell>
                    <TableCell><Badge variant={p.status === "published" ? "default" : "outline"} className="capitalize">{p.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-ct-muted">{p.attestationRate ?? 0}%</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {p.status === "draft" && <Button variant="ghost" size="sm" onClick={() => requestPublish(p.id)}>Request Publish</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Risk tab
// ---------------------------------------------------------------------------
function VendorRiskPanel() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorRiskProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ vendors?: VendorRiskProfile[] }>("/api/v1/projexa/vendor-risk", "vendor risk profiles");
      setVendors(data.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load vendor risk profiles");
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/vendors/new")}><Plus className="size-4" /> Add Vendor</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <div className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
          ) : vendors.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No vendors under risk tracking yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Risk Tier</TableHead><TableHead>Risk Score</TableHead></TableRow></TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium text-ct-navy">{v.name}</TableCell>
                    <TableCell><Badge variant={v.riskTier === "high" ? "destructive" : v.riskTier === "medium" ? "secondary" : "outline"} className="capitalize">{v.riskTier}</Badge></TableCell>
                    <TableCell className="text-ct-muted">{v.riskScore ?? "Not yet assessed"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fraud / Incident Cases tab
// ---------------------------------------------------------------------------
function FraudCasesPanel() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ cases?: FraudCase[] }>("/api/v1/projexa/fraud-cases", "fraud/incident cases");
      setCases(data.cases ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load fraud/incident cases");
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function transition(caseId: string, status: string) {
    try {
      await fetchOk(`/api/v1/projexa/fraud-cases/${caseId}`, "the case status", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      void load();
    } catch {
      // best-effort refresh; error already thrown from fetchOk
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/cases/new")}><Plus className="size-4" /> Log Case</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <div className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
          ) : cases.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No cases logged yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Exposure</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-ct-row-hover" onClick={() => router.push(`/grc/cases/${c.id}`)}>
                    <TableCell className="text-ct-muted">{c.caseNumber}</TableCell>
                    <TableCell className="font-medium text-ct-navy">{c.title}</TableCell>
                    <TableCell className="capitalize text-ct-muted">{c.fraudType.replace("_", " ")}</TableCell>
                    <TableCell className="text-ct-muted">{c.financialExposure ? `${currencyLabel(undefined, currencies)}${Number(c.financialExposure).toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell><Badge variant={c.status === "resolved" ? "default" : c.status === "confirmed" ? "destructive" : "outline"} className="capitalize">{c.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      {(FRAUD_TRANSITIONS[c.status] ?? []).map((next) => (
                        <Button key={next} variant="ghost" size="sm" onClick={() => transition(c.id, next)} className="capitalize">{next.replace("_", " ")}</Button>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access Review tab
// ---------------------------------------------------------------------------
function AccessReviewPanel() {
  const router = useRouter();
  const [cycles, setCycles] = useState<AccessReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOk<{ cycles?: AccessReviewCycle[] }>("/api/v1/projexa/access-review", "access review cycles");
      setCycles(data.cycles ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load access review cycles");
      setCycles([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" size="sm" onClick={() => router.push("/grc/access-review/new")}><Plus className="size-4" /> Open Cycle</Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
      ) : loadError ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></CardContent></Card>
      ) : cycles.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No access review cycles opened yet.</CardContent></Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-2">
            {cycles.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/grc/access-review/${c.id}`)}
                className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-ct-row-hover"
              >
                <div className="font-medium text-ct-navy">{c.name}</div>
                <div className="text-xs capitalize text-ct-muted">{c.status}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance Register tab (statutory/regulatory obligations calendar --
// read-only here; compliance-tracker already has its own native /compliance
// create flow this reuses via the shared compliance-service.ts).
// ---------------------------------------------------------------------------
function ComplianceRegisterPanel() {
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      const data = await fetchOk<{ register?: ComplianceItem[] }>(`/api/v1/projexa/compliance-register?${params.toString()}`, "the compliance register");
      setItems(data.register ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load compliance register");
      setItems([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search` is read on explicit Search click, not reactively.
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search obligations…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} className="max-w-xs" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["pending", "in_progress", "completed", "overdue", "not_applicable"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()}>Search</Button>
      </div>
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>
          ) : loadError ? (
            <div className="p-4 text-center text-sm text-ct-muted space-y-3"><p role="alert">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-ct-muted">No compliance obligations found.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Department</TableHead><TableHead>Due Date</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium text-ct-navy">{i.title}</TableCell>
                    <TableCell className="text-ct-muted">{i.complianceType}</TableCell>
                    <TableCell className="text-ct-muted">{i.department?.name ?? "—"}</TableCell>
                    <TableCell className="text-ct-muted">{i.dueDate ? formatDate(i.dueDate) : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{i.priority}</Badge></TableCell>
                    <TableCell><Badge variant={i.status === "completed" ? "default" : i.status === "overdue" ? "destructive" : "outline"} className="capitalize">{i.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root client
// ---------------------------------------------------------------------------
function GrcPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "dashboard");

  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Risk &amp; Compliance</h1>
        <p className="text-sm text-ct-muted mt-1 flex items-center gap-2">
          <ShieldAlert className="size-4" /> Real GRC data — risk register, audits, policies, vendor risk, fraud cases, access review, and statutory obligations.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="risks">Risk Register</TabsTrigger>
          <TabsTrigger value="audits">Audits &amp; Findings</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="vendor-risk">Vendor Risk</TabsTrigger>
          <TabsTrigger value="fraud">Fraud &amp; Incidents</TabsTrigger>
          <TabsTrigger value="access-review">Access Review</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Register</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardPanel /></TabsContent>
        <TabsContent value="risks"><RiskRegisterPanel /></TabsContent>
        <TabsContent value="audits"><AuditsPanel /></TabsContent>
        <TabsContent value="policies"><PoliciesPanel /></TabsContent>
        <TabsContent value="vendor-risk"><VendorRiskPanel /></TabsContent>
        <TabsContent value="fraud"><FraudCasesPanel /></TabsContent>
        <TabsContent value="access-review"><AccessReviewPanel /></TabsContent>
        <TabsContent value="compliance"><ComplianceRegisterPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function GrcPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-ct-muted" /></div>}>
      <GrcPageInner />
    </Suspense>
  );
}
