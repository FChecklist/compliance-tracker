"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// Wave 43 (VERIDIAN Capability Registry, PLATFORM_STRATEGY.md §24). Two
// on-demand, admin-gated actions: backfill (index everything that existed
// before this wave) and a duplicate audit (surface candidate near-duplicate
// worker agents/automation rules for a human to review -- never merges or
// deletes anything itself).
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Database, Search, AlertTriangle, Gauge, GitBranch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DuplicateCandidate = {
  a: { entityType: string; entityId: string; content: string };
  b: { entityType: string; entityId: string; content: string };
  score: number;
};

type RegistryModule = { moduleKey: string; displayName: string; domain: string; category: string | null };
type ImpactRow = { dependentTable: string; depth: number; viaColumn: string | null };
type ImpactResult = { moduleKey: string; qualifiedTable: string; depth: number; rows: ImpactRow[] };

/** "table:compliance.pms_budgets" -> "compliance.pms_budgets"; "asset_type:document" -> "document (asset type)". Matches the two node-key shapes platform.graph_impact() can return (PART_B_STATUS.md 1.8). */
function formatDependentTable(nodeKey: string): string {
  if (nodeKey.startsWith("table:")) return nodeKey.slice("table:".length);
  if (nodeKey.startsWith("asset_type:")) return `${nodeKey.slice("asset_type:".length)} (asset type)`;
  return nodeKey;
}

type CoverageByType = { total: number; indexed: number; coveragePercent: number };
type CoverageReport = {
  worker_agent: CoverageByType;
  automation_rule: CoverageByType;
  module: CoverageByType;
  dynamic_chain: CoverageByType;
  overall: CoverageByType;
};

const COVERAGE_LABELS: Record<keyof Omit<CoverageReport, "overall">, string> = {
  worker_agent: "Worker agents",
  automation_rule: "Automation rules",
  module: "Modules",
  dynamic_chain: "Dynamic chains",
};

export default function CapabilityRegistryPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);

  const [modules, setModules] = useState<RegistryModule[]>([]);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string>("");
  const [impactDepth, setImpactDepth] = useState<"1" | "2">("2");
  const [impactLoading, setImpactLoading] = useState(false);
  const [impact, setImpact] = useState<ImpactResult | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setIsAdmin(d.role === "admin"));
  }, []);

  const checkCoverage = useCallback(async () => {
    setCheckingCoverage(true);
    try {
      const res = await fetch("/api/capability-registry/coverage");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCoverage(data);
    } catch {
      toast.error("Coverage check failed");
    } finally {
      setCheckingCoverage(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) checkCoverage();
  }, [isAdmin, checkCoverage]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/capability-registry/modules")
      .then((r) => r.json())
      .then((d) => setModules(d.modules ?? []))
      .catch(() => toast.error("Failed to load module list"));
  }, [isAdmin]);

  const runImpactAnalysis = async () => {
    if (!selectedModuleKey) return;
    setImpactLoading(true);
    setImpact(null);
    try {
      const res = await fetch(`/api/capability-registry/impact?moduleKey=${encodeURIComponent(selectedModuleKey)}&depth=${impactDepth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Impact analysis failed");
      setImpact(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impact analysis failed");
    } finally {
      setImpactLoading(false);
    }
  };

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await fetch("/api/capability-registry/backfill", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`Indexed ${data.agents} worker agents, ${data.rules} automation rules, ${data.modules} modules`);
      if (data.coverage) setCoverage(data.coverage);
    } catch {
      toast.error("Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    try {
      const res = await fetch("/api/capability-registry/duplicates");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDuplicates(data.duplicates ?? []);
    } catch {
      toast.error("Duplicate audit failed");
    } finally {
      setAuditing(false);
    }
  };

  if (!isAdmin) {
    return <p className="text-sm text-ct-muted">This page is only available to organisation admins.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-ct-saffron-text" />
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Capability Registry</h1>
          <p className="text-sm text-ct-muted mt-1">What VERI FDE checks before ever proposing a new Worker Agent -- a semantic index of every worker agent, automation rule, and module, so requests are matched against what already exists instead of re-deriving the same context every time.</p>
        </div>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-ct-teal" />
              <h2 className="text-sm font-semibold text-ct-navy">Index coverage</h2>
            </div>
            <Button onClick={checkCoverage} disabled={checkingCoverage} size="sm" variant="ghost">
              {checkingCoverage ? <Loader2 className="size-4 animate-spin" /> : "Refresh"}
            </Button>
          </div>
          <p className="text-xs text-ct-muted">How much of each source is actually present in the embedding index right now, measured directly against compliance.embeddings -- independent of whether a backfill run reported success.</p>
          {coverage ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.keys(COVERAGE_LABELS) as (keyof typeof COVERAGE_LABELS)[]).map((key) => {
                const c = coverage[key];
                return (
                  <div key={key} className="space-y-1">
                    <p className="text-xs text-ct-muted">{COVERAGE_LABELS[key]}</p>
                    <p className="text-lg font-semibold text-ct-navy">{c.coveragePercent}%</p>
                    <p className="text-[11px] text-ct-muted">{c.indexed}/{c.total} indexed</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ct-muted">{checkingCoverage ? "Checking..." : "No coverage data yet."}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy">Backfill index</h2>
            <p className="text-xs text-ct-muted">Index everything created before this wave. Safe to run more than once -- already-indexed capabilities are skipped.</p>
            <Button onClick={runBackfill} disabled={backfilling} size="sm" className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {backfilling ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Database className="size-4 mr-2" />}
              Run Backfill
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-ct-navy">Duplicate audit</h2>
            <p className="text-xs text-ct-muted">Surface capabilities that look like near-duplicates of each other, for you to review -- nothing is ever merged or deleted automatically.</p>
            <Button onClick={runAudit} disabled={auditing} size="sm" variant="outline">
              {auditing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />}
              Run Audit
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-ct-teal" />
            <h2 className="text-sm font-semibold text-ct-navy">Impact analysis</h2>
          </div>
          <p className="text-xs text-ct-muted">Pick a module and see every table that would break if its own table changed shape -- a live traversal of the schema dependency graph (platform.graph_impact), not a static doc.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedModuleKey} onValueChange={setSelectedModuleKey}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a module..." />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.moduleKey} value={m.moduleKey}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={impactDepth} onValueChange={(v) => setImpactDepth(v as "1" | "2")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Depth 1</SelectItem>
                <SelectItem value="2">Depth 2</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runImpactAnalysis} disabled={impactLoading || !selectedModuleKey} size="sm" variant="outline">
              {impactLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <GitBranch className="size-4 mr-2" />}
              Analyze impact
            </Button>
          </div>

          {impact && (
            impact.rows.length === 0 ? (
              <p className="text-sm text-ct-muted">Nothing depends on {impact.qualifiedTable} within depth {impact.depth}.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dependent table</TableHead>
                      <TableHead className="w-20">Depth</TableHead>
                      <TableHead>Via column</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {impact.rows.map((row, i) => (
                      <TableRow key={`${row.dependentTable}-${i}`}>
                        <TableCell className="font-mono text-xs">{formatDependentTable(row.dependentTable)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{row.depth}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-ct-muted">{row.viaColumn ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {duplicates !== null && (
        <div className="space-y-2">
          {duplicates.length === 0 ? (
            <p className="text-sm text-ct-muted">No likely duplicates found.</p>
          ) : (
            duplicates.map((dup, i) => (
              <Card key={i} className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-ct-saffron-text" />
                    <Badge variant="secondary" className="text-xs">{Math.round(dup.score * 100)}% similar</Badge>
                  </div>
                  <p className="text-sm text-ct-navy"><span className="font-semibold">{dup.a.entityType}:</span> {dup.a.content}</p>
                  <p className="text-sm text-ct-navy"><span className="font-semibold">{dup.b.entityType}:</span> {dup.b.content}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
