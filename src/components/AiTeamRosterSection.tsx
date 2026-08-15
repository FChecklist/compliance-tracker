"use client";

// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18): "internal AI Team roster is static, not admin-editable."
// Admin edit surface for src/lib/ai-team/roster-overrides.ts -- lists every
// LLM-backed role in roster.ts with its current effective model (DB
// override if one is set, else roster.ts's own static default) and lets a
// veridian_admin swap it for any other model already recognized somewhere
// in the roster (see roster-overrides.ts's KNOWN_MODELS -- an override can
// never point at an unverified model id).
import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, Search, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type RosterRow = {
  roleKey: string;
  team: string;
  title: string;
  staticModel: string | null;
  overrideModel: string | null;
  effectiveModel: string | null;
  isHuman: boolean;
  isCodeOnly: boolean;
};

export default function AiTeamRosterSection() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [knownModels, setKnownModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingModel, setPendingModel] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/ai/team/roster/overrides")
      .then(async (r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) {
          setRows(d.roster ?? []);
          setKnownModels(d.knownModels ?? []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  const llmBackedRows = useMemo(() => rows.filter((r) => !r.isHuman && !r.isCodeOnly), [rows]);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return llmBackedRows;
    return llmBackedRows.filter(
      (r) => r.roleKey.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.team.toLowerCase().includes(q)
    );
  }, [llmBackedRows, search]);

  const saveOverride = async (roleKey: string, model: string) => {
    setSavingRole(roleKey);
    try {
      const res = await fetch("/api/ai/team/dispatch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleKey, model }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to set override");
      }
      toast.success(`${roleKey} now routes to ${model}`);
      setPendingModel((p) => { const next = { ...p }; delete next[roleKey]; return next; });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set override");
    } finally {
      setSavingRole(null);
    }
  };

  const clearOverride = async (roleKey: string) => {
    setSavingRole(roleKey);
    try {
      const res = await fetch("/api/ai/team/dispatch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleKey, model: null }),
      });
      if (!res.ok) throw new Error("Failed to reset override");
      toast.success(`${roleKey} reset to its default model`);
      load();
    } catch {
      toast.error("Failed to reset override");
    } finally {
      setSavingRole(null);
    }
  };

  if (forbidden) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="p-6 text-sm text-ct-muted">
          AI Team Roster management is available to veridian_admin users only.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-ct-navy">
          <Bot className="size-4" /> AI Team Roster
        </CardTitle>
        <p className="text-sm text-ct-muted">
          Override which model a VERIDIAN AI Team role calls, without editing roster.ts. Changes apply to the next
          dispatch of that role across every real dispatch surface.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-ct-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search role, title, or team"
            className="h-9 pl-8"
          />
        </div>

        <div className="border border-ct-border rounded-lg overflow-hidden">
          <div className="max-h-[480px] overflow-y-auto divide-y divide-ct-border">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-3"><Skeleton className="h-10 w-full" /></div>
              ))
            ) : filteredRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-ct-muted">No roles match this search.</p>
            ) : (
              filteredRows.map((r) => {
                const isOverridden = !!r.overrideModel;
                const selectValue = pendingModel[r.roleKey] ?? r.effectiveModel ?? "";
                return (
                  <div key={r.roleKey} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ct-navy truncate">{r.title}</p>
                      <p className="text-[11px] text-ct-muted truncate">{r.roleKey} · {r.team}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOverridden && <Badge variant="secondary" className="text-[10px] bg-ct-accent text-ct-saffron">Overridden</Badge>}
                      <Select value={selectValue} onValueChange={(v) => setPendingModel((p) => ({ ...p, [r.roleKey]: v }))}>
                        <SelectTrigger className="w-[220px] h-8 text-xs">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          {knownModels.map((m) => (
                            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        disabled={savingRole === r.roleKey || !pendingModel[r.roleKey] || pendingModel[r.roleKey] === r.effectiveModel}
                        onClick={() => saveOverride(r.roleKey, pendingModel[r.roleKey])}
                        title="Save override"
                      >
                        <Save className="size-3.5" />
                      </Button>
                      {isOverridden && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={savingRole === r.roleKey}
                          onClick={() => clearOverride(r.roleKey)}
                          title="Reset to default"
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
