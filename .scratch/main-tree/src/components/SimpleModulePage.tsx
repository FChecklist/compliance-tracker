"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type FieldConfig = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea";
  required?: boolean;
  placeholder?: string;
};

export type ColumnConfig = {
  key: string;
  label: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
};

// Shared "list + inline add form" page used by every module that's simple
// CRUD shape (no special workflow like Board's minutes/amend or Policy's
// publish-approval, which get their own custom pages). Keeps ~18 modules
// visually and structurally consistent instead of hand-rolling near-
// identical pages repeatedly.
export function SimpleModulePage({
  title,
  subtitle,
  apiPath,
  listKey,
  columns,
  fields,
  addLabel = "Add",
  emptyMessage = "Nothing here yet.",
}: {
  title: string;
  subtitle: string;
  apiPath: string;
  listKey: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
  addLabel?: string;
  emptyMessage?: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(apiPath)
      .then((r) => r.json())
      .then((d) => {
        setRows(d[listKey] ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, [apiPath, listKey]);

  const submit = async () => {
    const missing = fields.find((f) => f.required && !formValues[f.key]?.trim());
    if (missing) {
      setError(`${missing.label} is required`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to save");
        return;
      }
      setFormValues({});
      setShowForm(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">{title}</h1>
          <p className="text-sm text-ct-muted mt-1">{subtitle}</p>
        </div>
        <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X className="size-4 mr-2" /> : <Plus className="size-4 mr-2" />}
          {showForm ? "Cancel" : addLabel}
        </Button>
      </div>

      {showForm && (
        <Card className="rounded-xl shadow-card bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs font-medium text-ct-navy">{f.label}{f.required && " *"}</label>
                <Input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  placeholder={f.placeholder}
                  value={formValues[f.key] ?? ""}
                  onChange={(e) => setFormValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-9"
                />
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button size="sm" onClick={submit} disabled={submitting} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
            {submitting ? "Saving..." : "Save"}
          </Button>
        </Card>
      )}

      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className="text-xs font-semibold text-ct-navy">{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => <TableCell key={c.key}><Skeleton className="h-4 w-24" /></TableCell>)}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-ct-muted text-sm">{emptyMessage}</TableCell></TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={(row.id as string) ?? i} className="hover:bg-ct-row-hover">
                    {columns.map((c) => (
                      <TableCell key={c.key} className="text-xs text-ct-slate">
                        {c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

export function StatusPill({ value }: { value: unknown }) {
  const v = String(value ?? "");
  const tone = /paid|filed|published|approved|closed|verified|implemented|held|satisfied/i.test(v)
    ? "bg-emerald-100 text-emerald-700"
    : /overdue|rejected|failed|critical|high/i.test(v)
    ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";
  return <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 font-medium ${tone}`}>{v.replace(/_/g, " ")}</Badge>;
}
