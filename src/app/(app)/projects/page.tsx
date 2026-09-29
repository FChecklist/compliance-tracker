"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge Phase 0 (ai-os/PROJEXA_SERVER_MERGE_PLAN.md): proof-
// of-concept port of PROJEXA's own Projects list (src/app/(app)/projects/
// page.tsx + ProjectsListClient.tsx there). Reads the SAME
// /api/v1/projexa/dashboard this app's own construction-dashboard/page.tsx
// already reads -- same org-summary payload, zero new backend route, zero
// HTTP hop to a separate origin (PROJEXA's version goes browser -> its own
// /api/projects/overview proxy -> callVeridian() -> this exact route; here
// it's one same-origin fetch straight to it).
//
// UI is compliance-tracker's own shadcn Table/Card/Dialog (matching the
// house convention every already-ported construction-* page uses), not
// PROJEXA's @fchecklist/veridian-ui-kit ScreenFrame/ListScreen -- porting
// the DATA and BEHAVIOUR, not the exact component tree, per the plan's own
// "reuse existing service functions directly" framing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, FolderKanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { downloadCsv, toCsv } from "@/lib/csv-export";
import {
  PROJECT_EXPORT_HEADERS,
  PROJECT_STATUS_OPTIONS,
  filterProjects,
  percentBarWidth,
  projectExportRows,
  projectStatusPresentation,
  type ProjectRow,
} from "@/lib/project-list";

type Product = { id: string; name: string };

export default function ProjectsPage() {
  const router = useRouter();
  const currencies = useCurrencies();

  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [financialsRedacted, setFinancialsRedacted] = useState(false);
  const [status, setStatus] = useState("");

  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/projexa/dashboard");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRows([]);
        setLoadError(body.error ?? `Couldn't load your projects (HTTP ${res.status})`);
        return;
      }
      setRows((body.projects ?? []) as ProjectRow[]);
      setFinancialsRedacted(Boolean(body.financialsRedacted));
      setLoadError(null);
    } catch (err) {
      setRows([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load your projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetch("/api/v1/projexa/products")
      .then((r) => r.json())
      .then((d) => {
        const list: Product[] = d.products ?? [];
        setProducts(list);
        if (list.length > 0) setProductId((prev) => prev || list[0].id);
      })
      .catch(() => {
        // Non-fatal -- the New Project dialog just shows "no product to attach to".
      });
  }, []);

  const shown = useMemo(() => filterProjects(rows, status), [rows, status]);

  const money = (n: number | null) =>
    n === null
      ? (financialsRedacted ? "Restricted" : "No BOQ yet")
      : `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const createProject = async () => {
    if (!productId || !name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, name: name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to create project");
      toast.success("Project created");
      setOpen(false);
      setName("");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Projects</h1>
          <p className="text-sm text-ct-muted mt-1">Every active construction project -- progress by BOQ value, contract value and status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PROJECT_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={loading || shown.length === 0}
            onClick={() => downloadCsv(
              `projects-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(PROJECT_EXPORT_HEADERS, projectExportRows(shown))
            )}
          >
            Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={products.length === 0}>
                <Plus className="size-4 mr-1" /> New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Project</DialogTitle><DialogDescription>Creates a project other modules (BOQ, schedule, RFIs...) can attach to.</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Project name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cedar Heights Villa -- Phase 1" />
                </div>
                {products.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Product</Label>
                    <Select value={productId} onValueChange={setProductId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={createProject} disabled={creating || !productId || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Create Project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {financialsRedacted && (
        <p className="text-xs text-ct-muted">Contract/project values need a manager role or above -- restricted for your account.</p>
      )}

      {loadError ? (
        <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">Could not load projects: {loadError}</CardContent></Card>
      ) : loading ? (
        <p className="text-sm text-ct-muted" aria-busy="true">Loading your projects...</p>
      ) : shown.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">
            {rows.length === 0 ? "No projects yet." : "No projects match this filter."}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>% complete</TableHead>
                  <TableHead>Contract value</TableHead>
                  <TableHead>Project value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const width = percentBarWidth(p.percentByValue);
                  const { glyph, word, className } = projectStatusPresentation(p);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/construction-dashboard?projectId=${p.id}`)}>
                      <TableCell className="font-medium text-ct-navy">
                        <Link
                          href={`/construction-dashboard?projectId=${p.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <FolderKanban className="size-3.5 text-ct-muted" /> {p.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {width === null ? (
                          <span className="text-ct-muted">No BOQ yet</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 shrink-0 rounded-full bg-gray-200">
                              <span className="block h-full rounded-full bg-green-600" style={{ width: `${width}%` }} />
                            </span>
                            <span className="tabular-nums text-[12.5px]">{width}%</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{money(p.contractValue)}</TableCell>
                      <TableCell>{money(p.projectValue)}</TableCell>
                      <TableCell className={className}>
                        <span aria-hidden="true">{glyph}</span> {word}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
