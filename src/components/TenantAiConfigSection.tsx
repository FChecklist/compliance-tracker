"use client";

import { useEffect, useState, useCallback } from "react";
import { Cpu, Save, RotateCcw, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Super Boss v2 plan task V2-5 (BYOB bring-your-own-AI-model, 2026-07-20):
// the per-org BYO AI model for the Mother Router's software_team scope (the
// AI Dev Team dispatch path that builds VERIDIAN). Mirrors
// OrchestraModelConfigSection's UI shape (provider select + model input +
// masked API key field + save/reset) but is a SINGLE config for the org, not
// a per-Orchestra-Layer matrix -- "the org's model" is one choice. The API
// key is never displayed: only a "key set" / "no key" indicator, and the
// placeholder explains "leave blank to keep existing key" on edit. The
// tier-eligibility guardrail is enforced server-side in
// computeSoftwareTeamResolution() (an ineligible tenant model silently
// downgrades, never bypasses the gate -- AGENTS.md Rule 9), so this UI does
// not and cannot promise the configured model will actually run; it reflects
// the admin's PREFERENCE, which the Mother Router honors only when eligible.
type Config = {
  id: string;
  provider: string;
  modelName: string;
  baseUrl: string | null;
  hasKey: boolean;
  isActive: boolean;
};

const PROVIDER_MODEL_PLACEHOLDER: Record<string, string> = {
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-1.5-flash",
  openrouter: "z-ai/glm-5.2",
};

export default function TenantAiConfigSection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState("openrouter");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch("/api/settings/tenant-ai-config")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const c: Config | null = data.config ?? null;
        setConfig(c);
        if (c) {
          setProvider(c.provider);
          setModelName(c.modelName ?? "");
          setBaseUrl(c.baseUrl ?? "");
        }
      })
      .catch(() => toast.error("Failed to load tenant AI configuration"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const save = async () => {
    if (!modelName.trim()) {
      toast.error("Model name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/tenant-ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          modelName: modelName.trim(),
          apiKey: apiKey || undefined,
          baseUrl: baseUrl.trim() || null,
          isActive: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      toast.success("Tenant AI model saved");
      setApiKey("");
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save tenant AI model");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!config) return;
    try {
      const res = await fetch(`/api/settings/tenant-ai-config/${config.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Reset to platform default");
      setConfig(null);
      setProvider("openrouter");
      setModelName("");
      setBaseUrl("");
      setApiKey("");
    } catch {
      toast.error("Failed to reset");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ct-navy">Tenant AI Model (Software Team Scope)</h3>
        <p className="text-xs text-ct-muted mt-0.5">
          Bring your own model for the AI Dev Team dispatch path. When configured, the Mother Router prefers
          your model for your org&apos;s software-team dispatches — but still runs it through the
          tier-eligibility guardrail (an ineligible model silently downgrades to the platform default, never a
          bypass). Keys are encrypted at rest, same as the Orchestra Layer config above. Routed through OpenRouter
          (e.g. <code className="font-mono">z-ai/glm-5.2</code>) by default.
        </p>
      </div>

      {loading ? (
        <div className="h-32 w-full animate-pulse rounded-lg bg-ct-cloud" />
      ) : (
        <div className="rounded-lg border border-ct-border p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="size-3.5 text-ct-saffron" />
              <span className="text-sm font-medium text-ct-navy">Your org&apos;s model</span>
            </div>
            {config ? (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-ct-teal/10 text-ct-teal font-medium">
                Custom: {config.provider} · {config.hasKey ? "key set" : "no key"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-ct-cloud text-ct-muted font-medium">
                Platform default
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={PROVIDER_MODEL_PLACEHOLDER[provider]}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-xs text-ct-muted">Base URL (optional)</Label>
            <Input
              placeholder="https://openrouter.ai/api/v1/chat/completions"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-8 text-xs font-mono mt-1"
            />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder={config?.hasKey ? "Leave blank to keep existing key" : "API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-8 text-xs font-mono pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ct-muted hover:text-ct-navy"
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs bg-ct-saffron hover:bg-ct-saffron-hover text-white"
              onClick={save}
              disabled={saving}
            >
              <Save className="size-3 mr-1" />
              Save
            </Button>
            {config && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={resetToDefault}>
                <RotateCcw className="size-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
