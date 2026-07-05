"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Key, Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  isActive: boolean;
  rateLimitPerMinute: number | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type ApiUsage = {
  totalRequests: number;
  rateLimitedRequests: number;
  rateLimitedRate: number;
  topRoutes: { route: string; method: string; count: number }[];
};

interface ApiKeySectionProps {
  onKeysCountChange?: (count: number) => void;
}

export default function ApiKeySection({ onKeysCountChange }: ApiKeySectionProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read"]);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [rateLimitDrafts, setRateLimitDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/settings/api-keys/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUsage(data))
      .catch(() => setUsage(null));
  }, []);

  const fetchKeys = useCallback(() => {
    setLoading(true);
    fetch("/api/settings/api-keys")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setKeys(data.keys ?? []);
        onKeysCountChange?.(data.keys?.length ?? 0);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error("Failed to load API keys");
      });
  }, [onKeysCountChange]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for the key");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName.trim(),
          scopes: newKeyScopes.join(","),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create key");
      }
      const data = await res.json();
      setNewlyCreatedKey(data.key);
      toast.success("API key generated");
      fetchKeys();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate API key");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error();
      toast.success(isActive ? "Key deactivated" : "Key activated");
      fetchKeys();
    } catch {
      toast.error("Failed to update key");
    }
  };

  const handleSetRateLimit = async (id: string) => {
    const raw = rateLimitDrafts[id];
    const rateLimitPerMinute = raw === undefined || raw.trim() === "" ? null : Number(raw);
    if (rateLimitPerMinute !== null && (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0)) {
      toast.error("Rate limit must be a positive whole number, or blank for unlimited");
      return;
    }
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateLimitPerMinute }),
      });
      if (!res.ok) throw new Error();
      toast.success(rateLimitPerMinute === null ? "Rate limit removed" : `Rate limit set to ${rateLimitPerMinute}/min`);
      fetchKeys();
    } catch {
      toast.error("Failed to update rate limit");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("API key deleted");
      fetchKeys();
    } catch {
      toast.error("Failed to delete key");
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ct-navy">API Keys</h3>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setNewKeyName("");
              setNewKeyScopes(["read"]);
              setNewlyCreatedKey(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8"
            >
              <Plus className="size-3.5 mr-1" />
              Generate New Key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base text-ct-navy">Generate API Key</DialogTitle>
            </DialogHeader>

            {newlyCreatedKey ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-ct-error-light border border-ct-error-medium">
                  <AlertTriangle className="size-5 text-ct-error shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-ct-error">
                      Copy this key now. You won&apos;t see it again.
                    </p>
                    <p className="text-xs text-ct-slate mt-1">
                      Store it securely. We cannot recover lost keys.
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <pre className="bg-ct-navy text-green-400 p-4 rounded-lg text-xs font-mono overflow-x-auto break-all">
                    {newlyCreatedKey}
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2 h-7 text-xs"
                    onClick={() => copyKey(newlyCreatedKey)}
                  >
                    {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setDialogOpen(false)}
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Key Name</Label>
                  <Input
                    placeholder="e.g. Production API"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Scopes</Label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={newKeyScopes.includes("read")}
                        onCheckedChange={() => toggleScope("read")}
                      />
                      <span className="text-sm text-ct-navy">Read</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={newKeyScopes.includes("write")}
                        onCheckedChange={() => toggleScope("write")}
                      />
                      <span className="text-sm text-ct-navy">Write</span>
                    </label>
                  </div>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="bg-ct-saffron hover:bg-ct-saffron-hover text-white w-full"
                >
                  {submitting ? "Generating..." : "Generate Key"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-6 bg-ct-cloud rounded-lg">
          <Key className="size-7 text-ct-border mx-auto mb-2" />
          <p className="text-sm text-ct-muted">No API keys generated yet.</p>
          <p className="text-xs text-ct-muted mt-1">
            Generate a key to integrate with the Veridian API.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-white border border-ct-border"
            >
              <Key className="size-4 text-ct-saffron shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ct-navy truncate">{k.name}</span>
                  <span className="text-[10px] font-mono text-ct-muted bg-ct-cloud px-1.5 py-0.5 rounded">
                    {k.keyPrefix}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {k.scopes.split(",").map((s) => (
                    <Badge
                      key={s}
                      variant="secondary"
                      className="text-[9px] px-1.5 py-0 bg-ct-accent text-ct-saffron font-medium"
                    >
                      {s.trim()}
                    </Badge>
                  ))}
                  {k.lastUsedAt && (
                    <span className="text-[10px] text-ct-muted">
                      Last used {formatDate(k.lastUsedAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    className="h-6 w-24 text-[11px]"
                    value={rateLimitDrafts[k.id] ?? (k.rateLimitPerMinute ?? "")}
                    onChange={(e) => setRateLimitDrafts((prev) => ({ ...prev, [k.id]: e.target.value }))}
                  />
                  <span className="text-[10px] text-ct-muted">req/min</span>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => handleSetRateLimit(k.id)}>
                    Save
                  </Button>
                </div>
              </div>
              <Switch
                checked={k.isActive}
                onCheckedChange={() => handleToggle(k.id, k.isActive)}
                className="data-[state=checked]:bg-ct-teal"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-ct-muted hover:text-ct-error shrink-0"
                onClick={() => handleDelete(k.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {usage && usage.totalRequests > 0 && (
        <div className="space-y-2 pt-2 border-t border-ct-border">
          <h4 className="text-xs font-semibold text-ct-muted uppercase">Usage (last 30 days)</h4>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-ct-cloud">
              <p className="text-ct-muted">Requests</p>
              <p className="font-semibold text-ct-navy">{usage.totalRequests.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-ct-cloud">
              <p className="text-ct-muted">Rate-limited</p>
              <p className="font-semibold text-ct-navy">{(usage.rateLimitedRate * 100).toFixed(1)}%</p>
            </div>
            <div className="p-2 rounded-lg bg-ct-cloud">
              <p className="text-ct-muted">Top endpoint</p>
              <p className="font-semibold text-ct-navy truncate">{usage.topRoutes[0]?.route ?? "—"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}