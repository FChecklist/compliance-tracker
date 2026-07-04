"use client";

import { useState, useEffect } from "react";
import { Bot, Eye, EyeOff, Save, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const PROVIDERS = [
  { id: "groq", name: "Groq", modelPlaceholder: "llama-3.3-70b-versatile", needsBaseUrl: false },
  { id: "openai", name: "OpenAI", modelPlaceholder: "gpt-4o-mini", needsBaseUrl: false },
  { id: "anthropic", name: "Anthropic (Claude)", modelPlaceholder: "claude-3-5-haiku-latest", needsBaseUrl: false },
  { id: "google", name: "Google AI (Gemini)", modelPlaceholder: "gemini-1.5-flash", needsBaseUrl: false },
  { id: "openrouter", name: "OpenRouter", modelPlaceholder: "meta-llama/llama-3.3-70b-instruct", needsBaseUrl: false },
  { id: "ollama", name: "Ollama (local)", modelPlaceholder: "llama3.2", needsBaseUrl: true },
  { id: "custom", name: "Custom endpoint", modelPlaceholder: "model-name", needsBaseUrl: true },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

export default function PersonalAiConfigSection() {
  const [provider, setProvider] = useState<ProviderId>("groq");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    fetch("/api/settings/page-agent-config")
      .then((r) => r.json())
      .then((data) => {
        if (data?.config) {
          setProvider(data.config.provider);
          setModel(data.config.model ?? "");
          setBaseUrl(data.config.baseUrl ?? "");
          setHasKey(!!data.config.hasKey);
          setIsActive(!!data.config.isActive);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error("Please enter a model name");
      return;
    }
    if (activeProvider.needsBaseUrl && !baseUrl.trim()) {
      toast.error("Please enter the endpoint URL");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/page-agent-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          baseUrl: activeProvider.needsBaseUrl ? baseUrl.trim() : undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("PageAgent configuration saved");
        setIsActive(true);
        if (apiKey.trim()) setHasKey(true);
        setApiKey("");
      } else {
        toast.error(data.error || "Failed to save configuration");
      }
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/settings/page-agent-config", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Personal PageAgent override removed — falling back to your organisation's default");
        setIsActive(false);
        setHasKey(false);
        setApiKey("");
      } else {
        toast.error(data.error || "Failed to clear configuration");
      }
    } catch {
      toast.error("Failed to clear configuration");
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <Card className="rounded-xl shadow-card bg-white">
        <CardContent className="pt-6 flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-ct-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl shadow-card bg-white">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="size-10 rounded-xl bg-ct-teal/10 flex items-center justify-center">
            <Bot className="size-5 text-ct-teal" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-ct-navy">My AI (PageAgent)</CardTitle>
            <p className="text-xs text-ct-muted mt-0.5">
              Override which model PageAgent uses just for you. Without this, it falls back to your
              organisation&apos;s configured default, then the platform default.
            </p>
          </div>
          {isActive && (
            <span className="ml-auto text-[10px] font-semibold bg-ct-teal/10 text-ct-teal px-2 py-1 rounded-full">
              Active
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Model</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={activeProvider.modelPlaceholder}
              className="h-9 font-mono text-sm"
            />
          </div>
        </div>

        {activeProvider.needsBaseUrl && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Endpoint URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="h-9 font-mono text-sm"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-ct-muted uppercase">
            API Key {activeProvider.id === "ollama" && "(usually not needed)"}
          </Label>
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "•••••••••••••••• (already set — enter a new key to replace)" : "Enter your API key"}
              className="h-9 pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ct-muted hover:text-ct-navy transition-colors"
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          {isActive ? (
            <Button
              variant="outline"
              className="text-ct-error border-ct-error/30 hover:bg-ct-error/5 text-sm font-medium"
              onClick={handleClear}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
              Remove override
            </Button>
          ) : (
            <span />
          )}
          <Button
            className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron text-sm font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
