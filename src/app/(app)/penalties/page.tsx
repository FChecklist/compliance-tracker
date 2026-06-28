"use client";

import { useEffect, useState, useMemo } from "react";
import { format, differenceInDays } from "date-fns";
import {
  AlertTriangle,
  Calculator,
  IndianRupee,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ComplianceItem = {
  id: string;
  title: string;
  complianceType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  department: { name: string };
  assignedTo: { name: string; avatarUrl: string | null } | null;
};

const PENALTY_RATES: Record<
  string,
  { interestRate: number; interestPeriod: "yearly" | "monthly"; penaltyPerDay?: number; penaltyMax?: number }
> = {
  GST: { interestRate: 18, interestPeriod: "yearly", penaltyPerDay: 200, penaltyMax: 5000 },
  TDS: { interestRate: 1.5, interestPeriod: "monthly" },
  PF: { interestRate: 12, interestPeriod: "yearly" },
  ESIC: { interestRate: 12, interestPeriod: "yearly" },
  MCA: { interestRate: 0, interestPeriod: "yearly", penaltyPerDay: 100, penaltyMax: 100000 },
  INCOME_TAX: { interestRate: 1, interestPeriod: "monthly" },
};

const DEFAULT_RATE = { interestRate: 18, interestPeriod: "yearly" as const };

function getStatusBadge(status: string) {
  if (status === "overdue") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

export default function PenaltiesPage() {
  const [overdueItems, setOverdueItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Calculator state
  const [calcType, setCalcType] = useState("GST");
  const [dueDate, setDueDate] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [taxAmount, setTaxAmount] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/compliance?status=overdue&limit=100")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setOverdueItems(d.compliance ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Calculate overdue days and est penalty for table rows
  const enrichedItems = useMemo(() => {
    return overdueItems.map((item) => {
      if (!item.dueDate) return { ...item, daysOverdue: 0, estPenalty: 0 };
      const days = Math.max(
        0,
        differenceInDays(new Date(), new Date(item.dueDate))
      );
      const rate = PENALTY_RATES[item.complianceType] ?? DEFAULT_RATE;
      // Use a rough estimate of 10000 as base for table display
      const baseAmount = 10000;
      let interest = 0;
      let penalty = 0;
      if (rate.interestPeriod === "monthly") {
        interest =
          baseAmount * (rate.interestRate / 100) * (days / 30);
      } else {
        interest =
          baseAmount * (rate.interestRate / 100) * (days / 365);
      }
      if (rate.penaltyPerDay) {
        penalty = Math.min(
          rate.penaltyPerDay * days,
          rate.penaltyMax ?? Infinity
        );
      }
      return {
        ...item,
        daysOverdue: days,
        estPenalty: Math.round(interest + penalty),
      };
    });
  }, [overdueItems]);

  // Live calculator
  const calcResult = useMemo(() => {
    const rate = PENALTY_RATES[calcType] ?? DEFAULT_RATE;
    let daysOverdue = 0;
    let interestAmount = 0;
    let penaltyAmount = 0;
    let interestRateDisplay = "0%";
    let totalLiability = 0;

    if (dueDate && paymentDate) {
      daysOverdue = Math.max(
        0,
        differenceInDays(new Date(paymentDate), new Date(dueDate))
      );
    }

    const amount = parseFloat(taxAmount) || 0;

    if (rate.interestRate > 0 && daysOverdue > 0) {
      if (rate.interestPeriod === "monthly") {
        interestAmount =
          amount * (rate.interestRate / 100) * (daysOverdue / 30);
        interestRateDisplay = `${rate.interestRate}% per month`;
      } else {
        interestAmount =
          amount * (rate.interestRate / 100) * (daysOverdue / 365);
        interestRateDisplay = `${rate.interestRate}% per annum`;
      }
    }

    if (rate.penaltyPerDay && daysOverdue > 0) {
      penaltyAmount = Math.min(
        rate.penaltyPerDay * daysOverdue,
        rate.penaltyMax ?? Infinity
      );
    }

    totalLiability = amount + interestAmount + penaltyAmount;

    return {
      daysOverdue,
      interestRateDisplay: rate.interestRate > 0 ? interestRateDisplay : "N/A",
      interestAmount,
      penaltyAmount,
      totalLiability,
    };
  }, [calcType, dueDate, paymentDate, taxAmount]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">
          Penalty Tracker
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          Calculate interest and penalties for overdue compliance filings
        </p>
      </div>

      {/* Section 1: Overdue Items Table */}
      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
            <AlertTriangle className="size-4 text-red-500" />
            Overdue Items ({enrichedItems.length})
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Title
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">
                  Type
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Due Date
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">
                  Days Overdue
                </TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy text-right">
                  Est. Penalty
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : enrichedItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-ct-muted text-sm"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="size-8 text-ct-border" />
                      <span>No overdue items — great job!</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                enrichedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-sm max-w-[240px] truncate text-ct-navy">
                      {item.title}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-medium border-ct-border text-ct-slate"
                      >
                        {item.complianceType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-ct-navy font-medium">
                      {item.dueDate
                        ? format(new Date(item.dueDate), "dd MMM yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-semibold",
                          item.daysOverdue > 30
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        )}
                      >
                        {item.daysOverdue} days
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold text-red-600">
                      {item.estPenalty > 0 ? `~${fmt(item.estPenalty)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Section 2: Manual Calculator */}
      <div>
        <h2 className="text-lg font-semibold text-ct-navy mb-3 flex items-center gap-2">
          <Calculator className="size-5 text-ct-saffron" />
          Penalty Calculator
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Input Panel */}
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-ct-navy">
                Input Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-ct-muted">
                  Compliance Type
                </Label>
                <Select value={calcType} onValueChange={setCalcType}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(PENALTY_RATES).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-ct-muted">
                  {PENALTY_RATES[calcType]
                    ? Object.entries(PENALTY_RATES[calcType])
                        .filter(
                          ([k]) =>
                            k !== "interestPeriod" &&
                            k !== "penaltyPerDay" &&
                            k !== "penaltyMax"
                        )
                        .map(
                          ([k, v]) =>
                            `${k}: ${v}${k === "interestRate" ? "%" : ""}`
                        )
                        .join(", ")
                    : "Default rates apply"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-ct-muted">
                  Due Date
                </Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-ct-muted">
                  Payment Date
                </Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-ct-muted">
                  Tax / Liability Amount (₹)
                </Label>
                <div className="relative">
                  <IndianRupee className="absolute left-2.5 top-2.5 size-4 text-ct-muted" />
                  <Input
                    type="number"
                    placeholder="e.g. 50000"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Output Panel */}
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-ct-navy">
                Calculated Result
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-ct-cloud">
                  <span className="text-sm text-ct-muted">Days Overdue</span>
                  <span
                    className={cn(
                      "text-sm font-bold",
                      calcResult.daysOverdue > 0
                        ? "text-red-600"
                        : "text-ct-navy"
                    )}
                  >
                    {calcResult.daysOverdue} day{calcResult.daysOverdue !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-ct-cloud">
                  <span className="text-sm text-ct-muted">
                    Applicable Interest Rate
                  </span>
                  <span className="text-sm font-bold text-ct-navy">
                    {calcResult.interestRateDisplay}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-ct-cloud">
                  <span className="text-sm text-ct-muted">Interest Amount</span>
                  <span className="text-sm font-bold text-ct-navy">
                    {fmt(calcResult.interestAmount)}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-ct-cloud">
                  <span className="text-sm text-ct-muted">Penalty Amount</span>
                  <span className="text-sm font-bold text-ct-navy">
                    {fmt(calcResult.penaltyAmount)}
                  </span>
                </div>

                <Separator />

                <div className="flex items-center justify-between p-4 rounded-lg bg-red-50 border border-red-200">
                  <span className="text-sm font-semibold text-red-700">
                    Total Liability
                  </span>
                  <span className="text-lg font-bold text-red-700">
                    {fmt(calcResult.totalLiability)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}