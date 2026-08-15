"use client";

// VERIDIAN Review Framework gap-closure: Sales Pipeline (task-20260718-
// 082004, 2026-08-07). Closes, in one coherent surface:
// - "CRUD & Approval Workflow Correctness" -- a real drag/drop Kanban for
//   Opportunities, reusing the dnd-kit pattern from the PMS/Tasks board
//   (src/app/(app)/pms/[projectId]/board/page.tsx) per the finding's own
//   recommended approach. That page's IssueCard/BoardColumn are inline, not
//   an importable component, so this is a parallel implementation of the
//   same pattern, not a shared import.
// - "Search, Filter & Bulk Operations" -- search box, owner filter, and a
//   multi-select bulk-reassign toolbar.
// - "Cross-Module Integration Consistency" -- the first real in-app
//   consumer of getSalesPipelineOverview()/listPipelineStages(), which
//   previously only had the /api/v1/projexa external-API consumer.
// - "AI Copilot / Worker Agent Integration Depth" -- the pipeline-level "at
//   risk this quarter" AI summary panel.
// - "Business Rule & Validation Accuracy" -- a failed drag (illegal stage
//   transition, e.g. reopening a closed deal without manager rank) reverts
//   the optimistic move and surfaces the server's real reason via toast,
//   not a silent no-op.
import { useEffect, useState, useCallback, useMemo } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { Loader2, Search, Sparkles, Download, Users, AlertTriangle } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PipelineStage = { id: string; stageKey: string; label: string; sortOrder: number; isWon: boolean; isLost: boolean };
type PipelineOpportunity = {
  id: string; name: string; stage: string; estimatedValue: string | null; ownerId: string | null;
  expectedCloseDate: string | null; aiWinProbability: number | null;
};
type StuckOpportunity = { id: string; daysInStage: number };
type AiSummary = { atRiskDealNames: string[]; summary: string; recommendedFocus: string; generatedAt: string };

function OpportunityCard({
  opp, stuckDays, selected, onToggleSelect, currencyText,
}: {
  opp: PipelineOpportunity; stuckDays: number | undefined; selected: boolean; onToggleSelect: () => void; currencyText: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border border-ct-border p-3 mb-2 hover:shadow-md transition-shadow ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-2">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-0.5" onClick={(e) => e.stopPropagation()} />
        <div {...listeners} {...attributes} className="flex-1 min-w-0 cursor-grab">
          <p className="text-sm font-medium text-ct-navy leading-snug truncate">{opp.name}</p>
          <p className="text-xs text-ct-muted mt-1">
            {opp.estimatedValue ? `${currencyText}${Number(opp.estimatedValue).toLocaleString()}` : "No value set"}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {opp.aiWinProbability != null && (
              <Badge variant="outline" className="text-[10px] gap-1 h-5"><Sparkles className="size-2.5 text-ct-saffron" /> {opp.aiWinProbability}%</Badge>
            )}
            {stuckDays != null && (
              <Badge variant="outline" className="text-[10px] gap-1 h-5 border-amber-300 text-amber-700"><AlertTriangle className="size-2.5" /> {stuckDays}d stuck</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageColumn({
  stage, opportunities, stuckById, selectedIds, onToggleSelect, currencyText,
}: {
  stage: PipelineStage; opportunities: PipelineOpportunity[]; stuckById: Map<string, number>;
  selectedIds: Set<string>; onToggleSelect: (id: string) => void; currencyText: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.stageKey });
  const totalValue = opportunities.reduce((sum, o) => sum + (o.estimatedValue ? Number(o.estimatedValue) : 0), 0);

  return (
    <div className="flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold text-ct-navy">{stage.label}</h3>
        <span className="text-xs text-ct-muted bg-ct-cloud rounded-full px-2 py-0.5">{opportunities.length} · {currencyText}{totalValue.toLocaleString()}</span>
      </div>
      <div ref={setNodeRef} className={`rounded-xl p-2 min-h-[300px] transition-colors ${isOver ? "bg-ct-accent/40" : "bg-ct-cloud/50"}`}>
        {opportunities.map((opp) => (
          <OpportunityCard
            key={opp.id} opp={opp} stuckDays={stuckById.get(opp.id)} selected={selectedIds.has(opp.id)}
            onToggleSelect={() => onToggleSelect(opp.id)} currencyText={currencyText}
          />
        ))}
      </div>
    </div>
  );
}

export default function PipelineKanbanBoard() {
  const currencies = useCurrencies();
  const currencyText = currencyLabel(undefined, currencies);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [stuck, setStuck] = useState<StuckOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reassignTo, setReassignTo] = useState("");
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(async () => {
    const [stagesRes, oppRes, stuckRes] = await Promise.all([
      fetch("/api/crm/pipeline/stages"), fetch("/api/crm/opportunities"), fetch("/api/crm/pipeline/stuck"),
    ]);
    const [stagesData, oppData, stuckData] = await Promise.all([stagesRes.json(), oppRes.json(), stuckRes.json()]);
    setStages((stagesData.stages ?? []).sort((a: PipelineStage, b: PipelineStage) => a.sortOrder - b.sortOrder));
    setOpportunities(oppData.opportunities ?? []);
    setStuck(stuckData.stuck ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stuckById = useMemo(() => new Map(stuck.map((s) => [s.id, s.daysInStage])), [stuck]);
  const owners = useMemo(() => [...new Set(opportunities.map((o) => o.ownerId).filter((id): id is string => !!id))], [opportunities]);

  const filtered = useMemo(() => opportunities.filter((o) => {
    if (search.trim() && !o.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (ownerFilter !== "all" && o.ownerId !== ownerFilter) return false;
    return true;
  }), [opportunities, search, ownerFilter]);

  const byStage = useMemo(() => {
    const map = new Map<string, PipelineOpportunity[]>();
    for (const stage of stages) map.set(stage.stageKey, []);
    for (const opp of filtered) (map.get(opp.stage) ?? map.set(opp.stage, []).get(opp.stage)!).push(opp);
    return map;
  }, [filtered, stages]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const oppId = active.id as string;
    const newStage = over.id as string;
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;

    const prevStage = opp.stage;
    setOpportunities((prev) => prev.map((o) => (o.id === oppId ? { ...o, stage: newStage } : o)));
    try {
      const res = await fetch(`/api/crm/opportunities/${oppId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: newStage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to move deal");
      }
    } catch (err) {
      setOpportunities((prev) => prev.map((o) => (o.id === oppId ? { ...o, stage: prevStage } : o)));
      toast.error(err instanceof Error ? err.message : "Failed to move deal");
    }
  };

  const bulkReassign = async () => {
    if (selectedIds.size === 0 || !reassignTo) return;
    try {
      const res = await fetch("/api/crm/opportunities/bulk-reassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityIds: [...selectedIds], ownerId: reassignTo }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Reassigned ${selectedIds.size} deal(s)`);
      setSelectedIds(new Set());
      load();
    } catch {
      toast.error("Failed to reassign deals");
    }
  };

  const generateAiSummary = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/crm/pipeline/ai-summary", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setAiSummary(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate pipeline insight");
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) return <p className="text-sm text-ct-muted">Loading pipeline...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ct-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals..." className="pl-8 h-9" />
          </div>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="All owners" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {owners.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/crm/pipeline/export"><Button variant="outline" size="sm"><Download className="size-3.5 mr-1.5" /> Export CSV</Button></a>
          <Button variant="outline" size="sm" onClick={generateAiSummary} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5 text-ct-saffron" />}
            Pipeline Insight
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-ct-border bg-ct-cloud/50 px-3 py-2">
          <Users className="size-3.5 text-ct-muted" />
          <span className="text-xs text-ct-muted">{selectedIds.size} selected</span>
          <Input value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} placeholder="New owner user ID" className="h-8 w-[200px] text-xs" />
          <Button size="sm" onClick={bulkReassign} disabled={!reassignTo}>Bulk Reassign</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {aiSummary && (
        <div className="rounded-lg border border-ct-saffron/30 bg-ct-saffron/5 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-ct-navy flex items-center gap-1.5"><Sparkles className="size-3.5 text-ct-saffron" /> Pipeline Insight</p>
          <p className="text-xs text-ct-muted">{aiSummary.summary}</p>
          {aiSummary.atRiskDealNames.length > 0 && (
            <p className="text-xs text-ct-muted">At risk: {aiSummary.atRiskDealNames.join(", ")}</p>
          )}
          <p className="text-xs font-medium text-ct-navy">Recommended focus: {aiSummary.recommendedFocus}</p>
        </div>
      )}

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id} stage={stage} opportunities={byStage.get(stage.stageKey) ?? []}
              stuckById={stuckById} selectedIds={selectedIds} onToggleSelect={toggleSelect} currencyText={currencyText}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
