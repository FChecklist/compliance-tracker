"use client";

export const dynamic = "force-dynamic";

// Wave 88 (Comparison CSV 2 gap analysis: CLM002 "Template Management" +
// CLM003 "Clause Library"). Clause library is reusable clause text,
// categorized/risk-rated; templates reference clauses via an ordered join
// rather than duplicating text.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { BookText, Plus, Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Clause = { id: string; title: string; category: string | null; bodyText: string; riskLevel: string | null; isStandard: boolean; version: number };
type Template = { id: string; name: string; contractType: string | null; description: string | null; isActive: boolean };
type TemplateClause = { id: string; clauseId: string; position: number; isOptional: boolean; clause: Clause };
type TemplateDetail = Template & { clauses: TemplateClause[] };

const RISK_VARIANT: Record<string, "default" | "secondary" | "outline"> = { low: "outline", medium: "secondary", high: "default" };

export default function ClmLibraryPage() {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(null);

  const [clauseDialogOpen, setClauseDialogOpen] = useState(false);
  const [clauseTitle, setClauseTitle] = useState("");
  const [clauseCategory, setClauseCategory] = useState("");
  const [clauseBody, setClauseBody] = useState("");
  const [clauseRisk, setClauseRisk] = useState("low");
  const [creatingClause, setCreatingClause] = useState(false);

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("");
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  const [addClauseId, setAddClauseId] = useState("");

  const load = useCallback(async () => {
    const [clauseRes, templateRes] = await Promise.all([fetch("/api/clm/clauses"), fetch("/api/clm/templates")]);
    setClauses((await clauseRes.json()).clauses ?? []);
    setTemplates((await templateRes.json()).templates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadTemplateDetail(id: string) {
    setSelectedTemplateId(id);
    const res = await fetch(`/api/clm/templates/${id}`);
    setTemplateDetail(res.ok ? await res.json() : null);
  }

  async function createClause() {
    if (!clauseTitle.trim() || !clauseBody.trim()) { toast.error("Title and clause text are required"); return; }
    setCreatingClause(true);
    const res = await fetch("/api/clm/clauses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clauseTitle, category: clauseCategory || undefined, bodyText: clauseBody, riskLevel: clauseRisk }),
    });
    setCreatingClause(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create clause"); return; }
    toast.success("Clause added to library");
    setClauseDialogOpen(false);
    setClauseTitle(""); setClauseCategory(""); setClauseBody(""); setClauseRisk("low");
    load();
  }

  async function createTemplate() {
    if (!templateName.trim()) { toast.error("Name is required"); return; }
    setCreatingTemplate(true);
    const res = await fetch("/api/clm/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: templateName, contractType: templateType || undefined }),
    });
    setCreatingTemplate(false);
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to create template"); return; }
    toast.success("Template created");
    setTemplateDialogOpen(false);
    setTemplateName(""); setTemplateType("");
    load();
  }

  async function addClauseToTemplate() {
    if (!selectedTemplateId || !addClauseId) return;
    const res = await fetch(`/api/clm/templates/${selectedTemplateId}/clauses`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clauseId: addClauseId }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to add clause"); return; }
    setAddClauseId("");
    loadTemplateDetail(selectedTemplateId);
  }

  async function removeClauseFromTemplate(templateClauseId: string) {
    if (!selectedTemplateId) return;
    const res = await fetch(`/api/clm/templates/${selectedTemplateId}/clauses/${templateClauseId}`, { method: "DELETE" });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to remove clause"); return; }
    loadTemplateDetail(selectedTemplateId);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy flex items-center gap-2"><BookText className="w-6 h-6" />Clause Library & Templates</h1>
        <p className="text-sm text-ct-muted mt-1">Reusable contract clauses and templates — generate a contract's text from a template on its detail page.</p>
      </div>

      {loading ? (
        <div className="text-center text-ct-muted p-10">Loading…</div>
      ) : (
        <Tabs defaultValue="clauses">
          <TabsList>
            <TabsTrigger value="clauses">Clause Library</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="clauses">
            <div className="flex justify-end mb-2">
              <Dialog open={clauseDialogOpen} onOpenChange={setClauseDialogOpen}>
                <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Clause</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Clause</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Title</Label><Input value={clauseTitle} onChange={(e) => setClauseTitle(e.target.value)} placeholder="e.g. Limitation of Liability" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Category</Label><Input value={clauseCategory} onChange={(e) => setClauseCategory(e.target.value)} placeholder="e.g. liability" /></div>
                      <div>
                        <Label>Risk Level</Label>
                        <Select value={clauseRisk} onValueChange={setClauseRisk}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div><Label>Clause Text</Label><Textarea rows={6} value={clauseBody} onChange={(e) => setClauseBody(e.target.value)} placeholder="Use {{customerName}}, {{contractTitle}}, {{contractValue}}, {{startDate}}, {{endDate}} as tokens." /></div>
                  </div>
                  <DialogFooter><Button onClick={createClause} disabled={creatingClause}>{creatingClause ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Clause"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-3">
              {clauses.length === 0 ? <p className="text-sm text-ct-muted p-6 text-center">No clauses yet.</p> : clauses.map((c) => (
                <Card key={c.id} className="rounded-xl shadow-card bg-white">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-ct-navy text-sm">{c.title}</h3>
                      <div className="flex gap-1">
                        {c.category && <Badge variant="outline">{c.category}</Badge>}
                        {c.riskLevel && <Badge variant={RISK_VARIANT[c.riskLevel] ?? "outline"}>{c.riskLevel} risk</Badge>}
                        <Badge variant="outline">v{c.version}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-ct-muted whitespace-pre-wrap line-clamp-3">{c.bodyText}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="templates">
            <div className="flex justify-end mb-2">
              <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogTrigger asChild><Button className="bg-ct-teal hover:bg-ct-teal/90"><Plus className="w-4 h-4 mr-1" />New Template</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Contract Template</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Name</Label><Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Standard MSA" /></div>
                    <div><Label>Contract Type</Label><Input value={templateType} onChange={(e) => setTemplateType(e.target.value)} placeholder="e.g. msa" /></div>
                  </div>
                  <DialogFooter><Button onClick={createTemplate} disabled={creatingTemplate}>{creatingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Template"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-ct-muted border-b border-ct-border"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Type</th></tr></thead>
                    <tbody className="divide-y divide-ct-border">
                      {templates.length === 0 ? <tr><td colSpan={2} className="p-6 text-center text-ct-muted">No templates yet.</td></tr>
                        : templates.map((t) => (
                          <tr key={t.id} className={`hover:bg-ct-row-hover cursor-pointer ${selectedTemplateId === t.id ? "bg-ct-row-hover" : ""}`} onClick={() => loadTemplateDetail(t.id)}>
                            <td className="p-3">{t.name}</td>
                            <td className="p-3">{t.contractType ?? "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="p-4">
                  {!selectedTemplateId || !templateDetail ? (
                    <p className="text-sm text-ct-muted">Select a template to manage its clauses.</p>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="font-medium text-ct-navy">{templateDetail.name}</h3>
                      <div className="flex gap-2">
                        <Select value={addClauseId} onValueChange={setAddClauseId}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Select clause to add" /></SelectTrigger>
                          <SelectContent>{clauses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button size="sm" onClick={addClauseToTemplate}><Plus className="w-3 h-3" /></Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {templateDetail.clauses.length === 0 ? <li className="text-ct-muted">No clauses added yet.</li> : templateDetail.clauses.map((tc) => (
                          <li key={tc.id} className="flex items-center justify-between border-b border-ct-border py-1">
                            <span>{tc.position}. {tc.clause.title}</span>
                            <Button size="icon" variant="ghost" onClick={() => removeClauseFromTemplate(tc.id)}><X className="w-3 h-3" /></Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
