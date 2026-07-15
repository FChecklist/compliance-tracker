"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ProjectNav from "@/components/pms/ProjectNav";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Budget = { id: string; name: string; fixedDate: string | null };
type BudgetDetail = Budget & {
  lineItems: Array<{ id: string; kind: string; description: string | null; amount: string }>;
  plannedTotal: number;
  actualLaborCost: number;
  totalHours: number;
};

export default function BudgetsPage() {
  const currencies = useCurrencies();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [projectName, setProjectName] = useState("");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [details, setDetails] = useState<Record<string, BudgetDetail>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [lineItemBudgetId, setLineItemBudgetId] = useState<string | null>(null);
  const [liKind, setLiKind] = useState("material");
  const [liDescription, setLiDescription] = useState("");
  const [liAmount, setLiAmount] = useState("");

  const load = useCallback(async () => {
    const [projectRes, budgetsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/pms/budgets?projectId=${projectId}`),
    ]);
    const [project, budgetsData] = await Promise.all([projectRes.json(), budgetsRes.json()]);
    setProjectName(project.name ?? "Project");
    const budgetList: Budget[] = budgetsData.budgets ?? [];
    setBudgets(budgetList);

    const entries = await Promise.all(
      budgetList.map(async (b) => {
        const r = await fetch(`/api/pms/budgets/${b.id}`);
        const d = await r.json();
        return [b.id, d] as const;
      })
    );
    setDetails(Object.fromEntries(entries));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const createBudget = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pms/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name }),
      });
      if (!res.ok) throw new Error();
      toast.success("Budget created");
      setOpen(false);
      setName("");
      load();
    } catch {
      toast.error("Failed to create budget");
    } finally {
      setCreating(false);
    }
  };

  const addLineItem = async (budgetId: string) => {
    if (!liAmount) return;
    try {
      const res = await fetch(`/api/pms/budgets/${budgetId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: liKind, description: liDescription, amount: liAmount }),
      });
      if (!res.ok) throw new Error();
      setLineItemBudgetId(null);
      setLiDescription("");
      setLiAmount("");
      load();
    } catch {
      toast.error("Failed to add line item");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ProjectNav projectId={projectId} projectName={projectName} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Plus className="size-4 mr-2" />
              New Budget
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Budget</DialogTitle>
              <DialogDescription>Create a new project budget.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Budget" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createBudget} disabled={creating || !name.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Create Budget
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : budgets.length === 0 ? (
        <p className="text-sm text-ct-muted py-10 text-center">No budgets yet. Create the first one.</p>
      ) : (
        <div className="space-y-4">
          {budgets.map((budget) => {
            const detail = details[budget.id];
            return (
              <Card key={budget.id} className="rounded-xl shadow-card bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                    <Wallet className="size-4 text-ct-teal" />
                    {budget.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail && (
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-ct-muted uppercase">Planned</p>
                        <p className="font-semibold text-ct-navy">{currencyLabel(undefined, currencies)}{detail.plannedTotal.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ct-muted uppercase">Actual Labor</p>
                        <p className="font-semibold text-ct-navy">{currencyLabel(undefined, currencies)}{detail.actualLaborCost.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ct-muted uppercase">Hours Logged</p>
                        <p className="font-semibold text-ct-navy">{detail.totalHours.toFixed(1)}</p>
                      </div>
                    </div>
                  )}
                  {detail?.lineItems.map((li) => (
                    <div key={li.id} className="flex items-center justify-between text-sm py-1 border-b border-ct-border last:border-0">
                      <span className="text-ct-navy capitalize">{li.kind}{li.description ? `: ${li.description}` : ""}</span>
                      <span className="text-ct-muted">{currencyLabel(undefined, currencies)}{Number(li.amount).toFixed(2)}</span>
                    </div>
                  ))}
                  {lineItemBudgetId === budget.id ? (
                    <div className="flex items-center gap-2 pt-2">
                      <Select value={liKind} onValueChange={setLiKind}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="material">Material</SelectItem>
                          <SelectItem value="labor">Labor</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input placeholder="Description" value={liDescription} onChange={(e) => setLiDescription(e.target.value)} className="h-8" />
                      <Input placeholder="Amount" type="number" value={liAmount} onChange={(e) => setLiAmount(e.target.value)} className="h-8 w-28" />
                      <Button size="sm" onClick={() => addLineItem(budget.id)}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setLineItemBudgetId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setLineItemBudgetId(budget.id)}>
                      <Plus className="size-3.5 mr-1.5" />
                      Add Line Item
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
