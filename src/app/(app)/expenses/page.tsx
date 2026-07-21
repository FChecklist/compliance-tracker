"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 1 (compliance-tracker/PROJEXA merge, module-mapping report
// finding GAP-CONSTR): project-linked expense capture, ported from
// PROJEXA's own ExpensesClient.tsx (construction-expense-service.ts
// backend, /api/v1/projexa/expenses) onto this repo's own list+dialog+
// ProjectPicker shell. Logging expenses here is also what makes the
// existing profit-and-loss-by-project report (erp-financial-report-
// service.ts) a real, populated view instead of a permanently-empty
// expense line -- no changes made to that report in this wave, it just
// starts reflecting real data once entries exist.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPicker, NoProjectsCard, type PickerProject } from "@/components/ProjectPicker";
import { currencyLabel, useCurrencies } from "@/lib/currency-format";

type Expense = { id: string; expenseHead: string; description: string | null; amount: string; expenseDate: string };

const HEADS = ["material", "labour", "transport", "subcontractor", "equipment", "misc"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const currencies = useCurrencies();
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [expenseHead, setExpenseHead] = useState("material");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: PickerProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId((prev) => prev || list[0].id);
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/expenses?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setExpenses(data.expenses ?? []);
    } catch {
      toast.error("Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createExpense = async () => {
    if (!projectId || !amount || !expenseDate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/projexa/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, expenseHead, description: description || undefined,
          amount: Number(amount), expenseDate,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Expense logged");
      setOpen(false);
      setDescription(""); setAmount("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to log expense");
    } finally {
      setCreating(false);
    }
  };

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Expenses</h1>
          <p className="text-sm text-ct-muted mt-1">Project-linked expense capture by head -- feeds the per-project P&amp;L view in Financial Reports.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={!projectId}>
              <Plus className="size-4 mr-1" /> Log Expense
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Expense</DialogTitle><DialogDescription>Recorded against the selected project.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Head</Label>
                <Select value={expenseHead} onValueChange={setExpenseHead}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{HEADS.map((h) => <SelectItem key={h} value={h} className="capitalize">{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Amount</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Date</Label>
                  <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createExpense} disabled={creating || !amount || !expenseDate} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Log Expense
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loadingProjects ? (
        <p className="text-sm text-ct-muted">Loading projects...</p>
      ) : projects.length === 0 ? (
        <NoProjectsCard icon={Receipt} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            <p className="text-sm text-ct-muted">Total logged: <span className="font-semibold text-ct-navy">{currencyLabel(undefined, currencies)}{total.toLocaleString()}</span></p>
          </div>

          {loading ? (
            <p className="text-sm text-ct-muted">Loading...</p>
          ) : expenses.length === 0 ? (
            <Card className="rounded-xl shadow-card bg-white"><CardContent className="pt-10 pb-10 text-center text-sm text-ct-muted">No expenses logged yet.</CardContent></Card>
          ) : (
            <Card className="rounded-xl shadow-card bg-white">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Date</TableHead><TableHead>Head</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-ct-muted whitespace-nowrap">{new Date(e.expenseDate).toLocaleDateString()}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs capitalize">{e.expenseHead}</Badge></TableCell>
                        <TableCell className="text-ct-muted">{e.description ?? "--"}</TableCell>
                        <TableCell className="text-right font-medium text-ct-navy">{currencyLabel(undefined, currencies)}{Number(e.amount).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
