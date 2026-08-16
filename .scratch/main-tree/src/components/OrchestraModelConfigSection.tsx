"use client";

import { useEffect, useState, useCallback } from "react";
import { Cpu, Save, RotateCcw, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Layer = { id: string; layerKey: string; name: string; layerOrder: number };
type Config = { id: string; orchestraLayerId: string | null; provider: string; modelName: string; hasKey: boolean; isActive: boolean };

const PROVIDER_MODEL_PLACEHOLDER: Record<string, string> = {
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-1.5-flash",
};

type LayerFormState = {
  provider: string;
  modelName: string;
  apiKey: string;
  showKey: boolean;
  saving: boolean;
};

export default function OrchestraModelConfigSection() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<Record<string, LayerFormState>>({});

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch("/api/settings/model-config")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setLayers(data.layers ?? []);
        setConfigs(data.configs ?? []);
      })
      .catch(() => toast.error("Failed to load model configuration"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formFor = (layerId: string): LayerFormState => {
    if (forms[layerId]) return forms[layerId];
    const existing = configs.find((c) => c.orchestraLayerId === layerId);
    return {
      provider: existing?.provider ?? "groq",
      modelName: existing?.modelName ?? "",
      apiKey: "",
      showKey: false,
      saving: false,
    };
  };

  const updateForm = (layerId: string, updates: Partial<LayerFormState>) => {
    setForms((prev) => ({ ...prev, [layerId]: { ...formFor(layerId), ...updates } }));
  };

  const save = async (layerId: string) => {
    const form = formFor(layerId);
    if (!form.modelName.trim()) {
      toast.error("Model name is required");
      return;
    }
    updateForm(layerId, { saving: true });
    try {
      const res = await fetch("/api/settings/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orchestraLayerId: layerId,
          provider: form.provider,
          modelName: form.modelName.trim(),
          apiKey: form.apiKey || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      toast.success("Model override saved");
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save model override");
    } finally {
      updateForm(layerId, { saving: false, apiKey: "" });
    }
  };

  const resetToDefault = async (configId: string) => {
    try {
      const res = await fetch(`/api/settings/model-config/${configId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Reset to platform default");
      fetchData();
    } catch {
      toast.error("Failed to reset");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ct-navy">Orchestra Layer Models</h3>
        <p className="text-xs text-ct-muted mt-0.5">
          Bring your own model per Orchestra Layer. Layers without an override use the platform
          default (Groq). Keys are encrypted the same way as AI Configuration above.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {layers.map((layer) => {
            const existing = configs.find((c) => c.orchestraLayerId === layer.id);
            const form = formFor(layer.id);
            return (
              <div key={layer.id} className="rounded-lg border border-ct-border p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-3.5 text-ct-saffron" />
                    <span className="text-sm font-medium text-ct-navy">{layer.name}</span>
                  </div>
                  {existing ? (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-ct-teal/10 text-ct-teal font-medium">
                      Custom: {existing.provider} · {existing.hasKey ? "key set" : "no key"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-ct-cloud text-ct-muted font-medium">
                      Platform default
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                  <Select
                    value={form.provider}
                    onValueChange={(v) => updateForm(layer.id, { provider: v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="groq">Groq</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={PROVIDER_MODEL_PLACEHOLDER[form.provider]}
                    value={form.modelName}
                    onChange={(e) => updateForm(layer.id, { modelName: e.target.value })}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={form.showKey ? "text" : "password"}
                      placeholder={existing?.hasKey ? "Leave blank to keep existing key" : "API key"}
                      value={form.apiKey}
                      onChange={(e) => updateForm(layer.id, { apiKey: e.target.value })}
                      className="h-8 text-xs font-mono pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => updateForm(layer.id, { showKey: !form.showKey })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ct-muted hover:text-ct-navy"
                    >
                      {form.showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-ct-saffron hover:bg-ct-saffron-hover text-white"
                    onClick={() => save(layer.id)}
                    disabled={form.saving}
                  >
                    <Save className="size-3 mr-1" />
                    Save
                  </Button>
                  {existing && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => resetToDefault(existing.id)}
                    >
                      <RotateCcw className="size-3 mr-1" />
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
