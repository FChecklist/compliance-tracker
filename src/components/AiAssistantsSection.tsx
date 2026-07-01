"use client";

import { useEffect, useState, useCallback } from "react";
import { Bot, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Assistant = {
  id: string;
  assistantNumber: number;
  label: string;
  status: "idle" | "working";
  personalityConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export default function AiAssistantsSection() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAssistants = useCallback(() => {
    setLoading(true);
    fetch("/api/assistants")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setAssistants(data.assistants ?? []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error("Failed to load AI Assistants");
      });
  }, []);

  useEffect(() => {
    fetchAssistants();
  }, [fetchAssistants]);

  const startEdit = (a: Assistant) => {
    setEditingId(a.id);
    setEditValue(a.label);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const saveLabel = async (id: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error("Label cannot be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/assistants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update label");
      }
      toast.success("Assistant renamed");
      setEditingId(null);
      fetchAssistants();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update label");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ct-navy">AI Assistants</h3>
        <p className="text-xs text-ct-muted mt-0.5">
          Your 5 personal AI assistants, each coordinating a set of worker agents on your behalf. See{" "}
          <span className="font-medium">AI Orchestra</span> in the sidebar for the full experience.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : assistants.length === 0 ? (
        <div className="text-center py-6 bg-ct-cloud rounded-lg">
          <Bot className="size-7 text-ct-border mx-auto mb-2" />
          <p className="text-sm text-ct-muted">No assistants provisioned yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {assistants.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-white border border-ct-border"
            >
              <div className="size-8 rounded-full bg-ct-accent flex items-center justify-center shrink-0">
                <Bot className="size-4 text-ct-saffron" />
              </div>
              <div className="flex-1 min-w-0">
                {editingId === a.id ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveLabel(a.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-ct-teal shrink-0"
                      disabled={saving}
                      onClick={() => saveLabel(a.id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-ct-muted shrink-0"
                      disabled={saving}
                      onClick={cancelEdit}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ct-navy truncate">{a.label}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-ct-muted hover:text-ct-navy shrink-0"
                      onClick={() => startEdit(a)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge
                    variant="secondary"
                    className={
                      a.status === "working"
                        ? "text-[9px] px-1.5 py-0 bg-ct-teal/10 text-ct-teal font-medium"
                        : "text-[9px] px-1.5 py-0 bg-ct-cloud text-ct-muted font-medium"
                    }
                  >
                    {a.status === "working" ? "Working" : "Idle"}
                  </Badge>
                  <span className="text-[10px] text-ct-muted">Since {formatDate(a.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
