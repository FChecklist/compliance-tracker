"use client";

// Priority 13 (Document Correspondent/Type Auto-Classification, Paperless-
// ngx pattern). A compact manager for the two things an org configures once
// and then forgets about: correspondents (who sends documents) and matching
// rules (what auto-tags them on ingest). Rendered from a Dialog trigger on
// the Documents page (src/app/(app)/documents/page.tsx) -- deliberately not
// its own full page, since this is genuinely small, admin-ish configuration,
// not a daily-use screen.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Tag as TagIcon, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Correspondent = { id: string; name: string };
type MatchingRule = {
  id: string;
  name: string;
  isActive: boolean;
  matchField: "filename" | "content" | "both";
  ruleType: "any_word" | "all_words" | "exact" | "regex";
  pattern: string;
  priority: number;
  targetCorrespondentId: string | null;
  targetCategory: string | null;
  targetTags: string[] | null;
};

const RULE_TYPE_LABELS: Record<MatchingRule["ruleType"], string> = {
  any_word: "Any word",
  all_words: "All words",
  exact: "Exact phrase",
  regex: "Regex",
};
const MATCH_FIELD_LABELS: Record<MatchingRule["matchField"], string> = {
  filename: "Filename only",
  content: "Extracted text only",
  both: "Filename + extracted text",
};

export default function DocumentClassificationManager() {
  const [correspondents, setCorrespondents] = useState<Correspondent[]>([]);
  const [rules, setRules] = useState<MatchingRule[]>([]);
  const [loading, setLoading] = useState(true);

  const [newCorrespondentName, setNewCorrespondentName] = useState("");
  const [savingCorrespondent, setSavingCorrespondent] = useState(false);

  const [ruleName, setRuleName] = useState("");
  const [matchField, setMatchField] = useState<MatchingRule["matchField"]>("both");
  const [ruleType, setRuleType] = useState<MatchingRule["ruleType"]>("any_word");
  const [pattern, setPattern] = useState("");
  const [targetCorrespondentId, setTargetCorrespondentId] = useState<string>("none");
  const [targetCategory, setTargetCategory] = useState("");
  const [targetTagsInput, setTargetTagsInput] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [correspondentsRes, rulesRes] = await Promise.all([
      fetch("/api/document-correspondents"),
      fetch("/api/document-matching-rules"),
    ]);
    const correspondentsData = await correspondentsRes.json();
    const rulesData = await rulesRes.json();
    setCorrespondents(correspondentsData.correspondents ?? []);
    setRules(rulesData.rules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCorrespondent = async () => {
    if (!newCorrespondentName.trim()) return;
    setSavingCorrespondent(true);
    try {
      const res = await fetch("/api/document-correspondents", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCorrespondentName.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewCorrespondentName("");
      toast.success("Correspondent added");
      load();
    } catch {
      toast.error("Failed to add correspondent");
    } finally {
      setSavingCorrespondent(false);
    }
  };

  const removeCorrespondent = async (id: string) => {
    try {
      const res = await fetch(`/api/document-correspondents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Correspondent removed");
      load();
    } catch {
      toast.error("Failed to remove correspondent");
    }
  };

  const addRule = async () => {
    if (!ruleName.trim() || !pattern.trim()) return;
    const targetTags = targetTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    if (targetCorrespondentId === "none" && !targetCategory.trim() && targetTags.length === 0) {
      toast.error("Set at least one of: correspondent, category, or tags");
      return;
    }
    setSavingRule(true);
    try {
      const res = await fetch("/api/document-matching-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName.trim(), matchField, ruleType, pattern: pattern.trim(),
          targetCorrespondentId: targetCorrespondentId === "none" ? null : targetCorrespondentId,
          targetCategory: targetCategory.trim() || null,
          targetTags: targetTags.length > 0 ? targetTags : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create rule");
      setRuleName(""); setPattern(""); setTargetCategory(""); setTargetTagsInput(""); setTargetCorrespondentId("none");
      toast.success("Matching rule created");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSavingRule(false);
    }
  };

  const toggleRuleActive = async (rule: MatchingRule) => {
    try {
      const res = await fetch(`/api/document-matching-rules/${rule.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const removeRule = async (id: string) => {
    try {
      const res = await fetch(`/api/document-matching-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Matching rule deleted");
      load();
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  if (loading) return <p className="text-sm text-ct-muted py-4">Loading...</p>;

  return (
    <div className="space-y-6 py-2">
      {/* Correspondents */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-ct-muted uppercase flex items-center gap-1.5">
          <Users className="size-3.5" /> Correspondents
        </Label>
        <div className="flex gap-2">
          <Input value={newCorrespondentName} onChange={(e) => setNewCorrespondentName(e.target.value)} placeholder="e.g. Acme Bank, GST Department" />
          <Button size="sm" onClick={addCorrespondent} disabled={savingCorrespondent || !newCorrespondentName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shrink-0">
            {savingCorrespondent ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          </Button>
        </div>
        {correspondents.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {correspondents.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs gap-1 pr-1">
                {c.name}
                <button onClick={() => removeCorrespondent(c.id)} className="hover:text-ct-error">
                  <Trash2 className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Matching rules */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-ct-muted uppercase flex items-center gap-1.5">
          <TagIcon className="size-3.5" /> Matching Rules
        </Label>
        <p className="text-xs text-ct-muted">Evaluated in priority order (first match wins) against a document&apos;s filename and/or its Document AI extracted text. Never overrides a category/correspondent a person already set.</p>

        <div className="rounded-lg border border-ct-border p-3 space-y-2.5 bg-ct-cloud/30">
          <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Rule name (e.g. Acme Bank Statements)" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={ruleType} onValueChange={(v) => setRuleType(v as MatchingRule["ruleType"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RULE_TYPE_LABELS) as MatchingRule["ruleType"][]).map((t) => <SelectItem key={t} value={t}>{RULE_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={matchField} onValueChange={(v) => setMatchField(v as MatchingRule["matchField"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MATCH_FIELD_LABELS) as MatchingRule["matchField"][]).map((f) => <SelectItem key={f} value={f}>{MATCH_FIELD_LABELS[f]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={ruleType === "regex" ? "^INV-\\d+" : "e.g. invoice receipt"} />
          <div className="grid grid-cols-3 gap-2">
            <Select value={targetCorrespondentId} onValueChange={setTargetCorrespondentId}>
              <SelectTrigger><SelectValue placeholder="Correspondent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No correspondent</SelectItem>
                {correspondents.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={targetCategory} onChange={(e) => setTargetCategory(e.target.value)} placeholder="Category (e.g. contract)" />
            <Input value={targetTagsInput} onChange={(e) => setTargetTagsInput(e.target.value)} placeholder="Tags, comma separated" />
          </div>
          <Button size="sm" onClick={addRule} disabled={savingRule || !ruleName.trim() || !pattern.trim()} className="w-full bg-ct-teal hover:bg-ct-teal-hover text-white">
            {savingRule ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Plus className="size-3.5 mr-1.5" />}
            Add Rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="text-xs text-ct-muted py-2">No matching rules yet -- documents keep getting classified manually until you add one.</p>
        ) : (
          <div className="divide-y divide-ct-border rounded-lg border border-ct-border">
            {rules.map((rule) => (
              <div key={rule.id} className="p-2.5 flex items-center gap-2">
                <Switch checked={rule.isActive} onCheckedChange={() => toggleRuleActive(rule)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ct-navy truncate">{rule.name}</p>
                  <p className="text-xs text-ct-muted truncate">
                    {RULE_TYPE_LABELS[rule.ruleType]} &quot;{rule.pattern}&quot; on {MATCH_FIELD_LABELS[rule.matchField].toLowerCase()}
                    {rule.targetCategory ? ` → category: ${rule.targetCategory}` : ""}
                    {rule.targetCorrespondentId ? ` → ${correspondents.find((c) => c.id === rule.targetCorrespondentId)?.name ?? "correspondent"}` : ""}
                    {rule.targetTags && rule.targetTags.length > 0 ? ` → tags: ${rule.targetTags.join(", ")}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
                  <Trash2 className="size-3.5 text-ct-error" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
