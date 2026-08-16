"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Eye,
  EyeOff,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ─────────────────────────── TYPES ─────────────────────────── */

type ProviderId = "groq" | "openai" | "anthropic" | "google";

interface ProviderConfig {
  id: ProviderId;
  name: string;
  tagline: string;
  color: string;
  bgColor: string;
  borderColor: string;
  keyPlaceholder: string;
}

interface ProviderState {
  key: string;
  showKey: boolean;
  extraction: boolean;
  qa: boolean;
  drafting: boolean;
  testing: boolean;
  testResult: "idle" | "success" | "error" | null;
}

/* ─────────────────────────── PROVIDERS ─────────────────────────── */

const PROVIDERS: ProviderConfig[] = [
  {
    id: "groq",
    name: "Groq",
    tagline: "Free & fast inference",
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    keyPlaceholder: "gsk_...",
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT-4o, GPT-4o-mini",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    keyPlaceholder: "sk-...",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    tagline: "Claude 3.5 Sonnet, Haiku",
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "google",
    name: "Google AI (Gemini)",
    tagline: "Gemini 1.5 Pro, Flash",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    keyPlaceholder: "AIza...",
  },
];

const INITIAL_STATE: Record<ProviderId, ProviderState> = {
  groq: { key: "", showKey: false, extraction: true, qa: true, drafting: false, testing: false, testResult: null },
  openai: { key: "", showKey: false, extraction: false, qa: false, drafting: false, testing: false, testResult: null },
  anthropic: { key: "", showKey: false, extraction: false, qa: false, drafting: false, testing: false, testResult: null },
  google: { key: "", showKey: false, extraction: false, qa: false, drafting: false, testing: false, testResult: null },
};

/* ─────────────────────────── COMPONENT ─────────────────────────── */

export default function AiConfigSection() {
  const [providers, setProviders] = useState<Record<ProviderId, ProviderState>>(INITIAL_STATE);
  const [usePlatformAI, setUsePlatformAI] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load saved config
  useEffect(() => {
    fetch("/api/settings/ai-config")
      .then((r) => r.json())
      .then((data) => {
        if (data?.providers) {
          setProviders((prev) => {
            const next = { ...prev };
            for (const p of PROVIDERS) {
              const saved = data.providers[p.id];
              if (saved) {
                next[p.id] = {
                  ...next[p.id],
                  extraction: saved.extraction ?? false,
                  qa: saved.qa ?? false,
                  drafting: saved.drafting ?? false,
                  // key is never returned, but we know it's configured if features are enabled
                };
              }
            }
            return next;
          });
        }
        if (data?.usePlatformAI !== undefined) {
          setUsePlatformAI(data.usePlatformAI);
        }
      })
      .catch(() => {
        // silently fail — use defaults
      });
  }, []);

  const updateProvider = useCallback(
    (id: ProviderId, updates: Partial<ProviderState>) => {
      setProviders((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));
    },
    []
  );

  const testConnection = async (id: ProviderId) => {
    const state = providers[id];
    if (!state.key.trim()) {
      toast.error("Please enter an API key first");
      return;
    }

    updateProvider(id, { testing: true, testResult: null });
    try {
      const res = await fetch("/api/settings/ai-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, key: state.key }),
      });
      const data = await res.json();
      if (data.success) {
        updateProvider(id, { testing: false, testResult: "success" });
        toast.success(`${PROVIDERS.find((p) => p.id === id)?.name} connection successful!`);
      } else {
        updateProvider(id, { testing: false, testResult: "error" });
        toast.error(data.error || "Connection failed");
      }
    } catch {
      updateProvider(id, { testing: false, testResult: "error" });
      toast.error("Failed to test connection. Check your key and try again.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        providers: Object.fromEntries(
          PROVIDERS.map((p) => [
            p.id,
            {
              key: providers[p.id].key || undefined,
              extraction: providers[p.id].extraction,
              qa: providers[p.id].qa,
              drafting: providers[p.id].drafting,
            },
          ])
        ),
        usePlatformAI,
      };

      const res = await fetch("/api/settings/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("AI configuration saved successfully");
      } else {
        toast.error(data.error || "Failed to save configuration");
      }
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="size-10 rounded-xl bg-ct-saffron/10 flex items-center justify-center">
            <Brain className="size-5 text-ct-saffron" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-ct-navy">
              AI Configuration (Bring Your Own Key)
            </CardTitle>
            <p className="text-xs text-ct-muted mt-0.5">
              Connect your own AI provider keys. Your keys are encrypted and used only for your
              organisation.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider Cards */}
        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const state = providers[provider.id];
            return (
              <div
                key={provider.id}
                className={cn(
                  "rounded-xl border p-4 space-y-4 transition-colors",
                  provider.borderColor,
                  state.key ? "bg-white" : provider.bgColor
                )}
              >
                {/* Provider Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "size-9 rounded-lg flex items-center justify-center font-bold text-sm",
                        provider.bgColor,
                        provider.color
                      )}
                    >
                      {provider.name[0]}
                    </div>
                    <div>
                      <p className={cn("text-sm font-semibold", provider.color)}>
                        {provider.name}
                        {provider.id === "groq" && (
                          <span className="ml-1.5 text-[10px] font-semibold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">
                            FREE
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ct-muted">{provider.tagline}</p>
                    </div>
                  </div>
                  {state.testResult && (
                    <div className="flex items-center gap-1.5 text-xs">
                      {state.testResult === "success" ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-ct-teal" />
                          <span className="text-ct-teal font-medium">Connected</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="size-3.5 text-ct-error" />
                          <span className="text-ct-error font-medium">Failed</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Key Input */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={state.showKey ? "text" : "password"}
                      placeholder={provider.keyPlaceholder}
                      value={state.key}
                      onChange={(e) =>
                        updateProvider(provider.id, {
                          key: e.target.value,
                          testResult: null,
                        })
                      }
                      className="h-9 pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateProvider(provider.id, { showKey: !state.showKey })
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ct-muted hover:text-ct-navy transition-colors"
                    >
                      {state.showKey ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs font-medium"
                    onClick={() => testConnection(provider.id)}
                    disabled={state.testing || !state.key.trim()}
                  >
                    {state.testing ? (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    ) : null}
                    Test Connection
                  </Button>
                </div>

                {/* Feature Checkboxes */}
                <div className="flex flex-wrap gap-4">
                  {(
                    [
                      { key: "extraction", label: "Use for Document Extraction" },
                      { key: "qa", label: "Use for Q&A" },
                      { key: "drafting", label: "Use for Drafting" },
                    ] as const
                  ).map((feat) => (
                    <label
                      key={feat.key}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={state[feat.key]}
                        onCheckedChange={(checked) =>
                          updateProvider(provider.id, {
                            [feat.key]: !!checked,
                          })
                        }
                        className="data-[state=checked]:bg-ct-saffron data-[state=checked]:border-ct-saffron"
                      />
                      <span className="text-xs text-ct-slate">{feat.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Platform AI Fallback */}
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-ct-saffron/10 flex items-center justify-center">
              <Zap className="size-4 text-ct-saffron" />
            </div>
            <div>
              <Label className="text-sm font-medium text-ct-navy">
                Use Platform AI (Groq Free)
              </Label>
              <p className="text-xs text-ct-muted">
                Fall back to VERIDIAN AI&apos;s built-in AI when no provider key is configured
              </p>
            </div>
          </div>
          <Switch
            checked={usePlatformAI}
            onCheckedChange={setUsePlatformAI}
            className="data-[state=checked]:bg-ct-saffron"
          />
        </div>

        <Separator />

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron text-sm font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            Save Configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}