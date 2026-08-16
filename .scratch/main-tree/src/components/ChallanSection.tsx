"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type Challan = {
  id: string;
  complianceItemId: string;
  bsrCode: string | null;
  challanSerialNumber: string | null;
  paymentDate: string | null;
  amount: string | null;
  bankName: string | null;
  description: string | null;
  createdAt: string;
};

function formatINR(amount: string | null): string {
  if (!amount) return "—";
  const num = Number(amount);
  return "₹" + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface ChallanSectionProps {
  complianceItemId: string;
}

export default function ChallanSection({ complianceItemId }: ChallanSectionProps) {
  const [challans, setChallans] = useState<Challan[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    bsrCode: "",
    challanSerialNumber: "",
    paymentDate: "",
    amount: "",
    bankName: "",
    description: "",
  });

  const fetchChallans = useCallback(() => {
    setLoading(true);
    fetch(`/api/challans?complianceItemId=${complianceItemId}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setChallans(data.challans ?? []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error("Failed to load challans");
      });
  }, [complianceItemId]);

  useEffect(() => {
    fetchChallans();
  }, [fetchChallans]);

  const handleSubmit = async () => {
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/challans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          complianceItemId,
          bsrCode: form.bsrCode || null,
          challanSerialNumber: form.challanSerialNumber || null,
          paymentDate: form.paymentDate || null,
          amount: form.amount,
          bankName: form.bankName || null,
          description: form.description || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create challan");
      }
      toast.success("Challan recorded successfully");
      setDialogOpen(false);
      setForm({
        bsrCode: "",
        challanSerialNumber: "",
        paymentDate: "",
        amount: "",
        bankName: "",
        description: "",
      });
      fetchChallans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record challan");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/challans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Challan deleted");
      fetchChallans();
    } catch {
      toast.error("Failed to delete challan");
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-ct-saffron" />
          <h3 className="text-sm font-semibold text-ct-navy">Challan Payments</h3>
          {challans.length > 0 && (
            <Badge variant="secondary" className="bg-ct-accent text-ct-saffron text-[10px] px-1.5 font-medium">
              {challans.length}
            </Badge>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8"
            >
              <Plus className="size-3.5 mr-1" />
              Add Challan
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base text-ct-navy">Record Challan Payment</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">BSR Code</Label>
                  <Input
                    placeholder="e.g. 0222125"
                    value={form.bsrCode}
                    onChange={(e) => updateField("bsrCode", e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Serial Number</Label>
                  <Input
                    placeholder="e.g. 123456"
                    value={form.challanSerialNumber}
                    onChange={(e) => updateField("challanSerialNumber", e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Payment Date</Label>
                  <Input
                    type="date"
                    value={form.paymentDate}
                    onChange={(e) => updateField("paymentDate", e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Amount (₹)</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Bank Name</Label>
                <Input
                  placeholder="e.g. State Bank of India"
                  value={form.bankName}
                  onChange={(e) => updateField("bankName", e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Description</Label>
                <Input
                  placeholder="Optional description"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className="h-9"
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white w-full"
              >
                {submitting ? "Recording..." : "Record Challan"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : challans.length === 0 ? (
        <div className="text-center py-6 bg-ct-cloud rounded-lg">
          <Receipt className="size-7 text-ct-border mx-auto mb-2" />
          <p className="text-sm text-ct-muted">No challan payments recorded yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-ct-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-ct-cloud/50 hover:bg-ct-cloud/50">
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9">BSR Code</TableHead>
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9">Serial No</TableHead>
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9">Payment Date</TableHead>
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9 text-right">Amount</TableHead>
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9">Bank</TableHead>
                <TableHead className="text-[10px] font-semibold text-ct-muted uppercase h-9 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {challans.map((c) => (
                <TableRow key={c.id} className="hover:bg-ct-row-hover">
                  <TableCell className="text-sm text-ct-navy font-mono text-xs">{c.bsrCode || "—"}</TableCell>
                  <TableCell className="text-sm text-ct-navy font-mono text-xs">{c.challanSerialNumber || "—"}</TableCell>
                  <TableCell className="text-sm text-ct-slate text-xs">{formatDate(c.paymentDate)}</TableCell>
                  <TableCell className="text-sm text-ct-navy font-semibold text-xs text-right">{formatINR(c.amount)}</TableCell>
                  <TableCell className="text-sm text-ct-slate text-xs">{c.bankName || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-ct-muted hover:text-ct-error"
                      onClick={() => handleDelete(c.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}