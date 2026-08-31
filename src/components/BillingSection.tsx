"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Receipt, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BillingPlan {
  id: string;
  planKey: string;
  name: string;
  baseFeeMonthlyUsd: string;
  perSeatMonthlyUsd: string;
  includedAiCostUsd: string;
  overageMultiplier: string;
}

interface CurrentUsagePreview {
  plan: BillingPlan;
  periodStart: string;
  periodEnd: string;
  lineItems: {
    seatCount: number;
    baseFeeUsd: number;
    seatFeeUsd: number;
    aiCostUsd: number;
    includedAiCostUsd: number;
    overageAiCostUsd: number;
    overageChargeUsd: number;
    totalUsd: number;
  };
}

interface BillingInvoice {
  id: string;
  invoiceNumber: number;
  periodStart: string;
  periodEnd: string;
  seatCount: number;
  totalUsd: string;
  status: string;
}

const fmtUsd = (n: number | string) => `$${Number(n).toFixed(2)}`;

// VERIDIAN Review Framework gap-closure, Commercial/Subscription & Pricing
// Model (2026-08-07): the first real settings surface for
// platform-billing-service.ts -- shows the plan an org is actually priced
// at (backing src/app/pricing/page.tsx's marketing tiers), the live
// current-period usage-to-invoice preview, and past generated invoices.
export default function BillingSection({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<CurrentUsagePreview | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);

  const load = useCallback(async () => {
    try {
      const [usageRes, invoicesRes] = await Promise.all([
        fetch("/api/billing/current-usage"),
        fetch("/api/billing/invoices"),
      ]);
      if (usageRes.ok) setPreview(await usageRes.json());
      if (invoicesRes.ok) setInvoices((await invoicesRes.json()).invoices ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generateInvoice() {
    setGenerating(true);
    try {
      const res = await fetch("/api/billing/invoices/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to generate invoice");
        return;
      }
      if (data.payment?.status === "not_configured") {
        toast.info("Invoice generated (no payment gateway configured yet -- see the invoice's status, not charged).");
      } else {
        toast.success("Invoice generated");
      }
      await load();
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Current Billing Period</h4>
          {preview && <Badge variant="outline">{preview.plan.name}</Badge>}
        </div>
        {preview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Base fee</div>
              <div className="font-medium">{fmtUsd(preview.lineItems.baseFeeUsd)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Seats ({preview.lineItems.seatCount})</div>
              <div className="font-medium">{fmtUsd(preview.lineItems.seatFeeUsd)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">
                AI usage ({fmtUsd(preview.lineItems.aiCostUsd)} of {fmtUsd(preview.lineItems.includedAiCostUsd)} included)
              </div>
              <div className="font-medium">{fmtUsd(preview.lineItems.overageChargeUsd)} overage</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Projected total</div>
              <div className="font-semibold text-ct-navy">{fmtUsd(preview.lineItems.totalUsd)}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No billing plan resolved for this organisation.</p>
        )}
        {isAdmin && (
          <Button size="sm" disabled={generating} onClick={generateInvoice}>
            {generating && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Generate last month&apos;s invoice
          </Button>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Invoice History</h4>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices generated yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    {new Date(inv.periodStart).toLocaleDateString()} - {new Date(inv.periodEnd).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{inv.seatCount}</TableCell>
                  <TableCell>{fmtUsd(inv.totalUsd)}</TableCell>
                  <TableCell>
                    <Badge variant={inv.status === "paid" ? "default" : "outline"}>{inv.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
