"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Globe,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const WEBHOOK_EVENTS = [
  { id: "item.created", label: "Item Created" },
  { id: "item.completed", label: "Item Completed" },
  { id: "item.overdue", label: "Item Overdue" },
  { id: "notice.received", label: "Notice Received" },
  { id: "challan.recorded", label: "Challan Recorded" },
  // Wave 58: ERP domain events -- same delivery infra, new event coverage.
  { id: "erp_journal_entry.submitted", label: "ERP: Journal Entry Submitted" },
  { id: "erp_cash_voucher.posted", label: "ERP: Cash Voucher Posted" },
  { id: "erp_payslip.finalized", label: "ERP: Payslip Finalized" },
  { id: "erp_purchase_requisition.approved", label: "ERP: Purchase Requisition Approved" },
] as const;

type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["id"];

interface DeliveryLog {
  id: string;
  statusCode: number;
  success: boolean;
  timestamp: string;
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  lastDeliveryStatus: "success" | "failed" | "pending" | null;
  deliveryLogs: DeliveryLog[];
}

function truncateUrl(url: string, maxLength: number = 40): string {
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength) + "...";
}

function getEventLabel(eventId: string): string {
  const found = WEBHOOK_EVENTS.find((e) => e.id === eventId);
  return found ? found.label : eventId;
}

function getStatusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (code >= 400 && code < 500) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}

export default function WebhookSection() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Form state
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<Set<WebhookEvent>>(new Set());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/webhooks");
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      const data = await res.json();
      setWebhooks(data);
    } catch {
      toast.error("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setFormName("");
    setFormUrl("");
    setFormEvents(new Set());
    setFormErrors({});
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim()) errors.name = "Name is required";
    if (!formUrl.trim()) {
      errors.url = "URL is required";
    } else if (!formUrl.startsWith("https://")) {
      errors.url = "URL must start with https://";
    }
    if (formEvents.size === 0) errors.events = "Select at least one event";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          url: formUrl.trim(),
          events: Array.from(formEvents),
        }),
      });
      if (!res.ok) throw new Error("Failed to create webhook");
      toast.success("Webhook created successfully");
      setDialogOpen(false);
      resetForm();
      fetchWebhooks();
    } catch {
      toast.error("Failed to create webhook");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/settings/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle webhook");
      setWebhooks((prev) =>
        prev.map((w) => (w.id === id ? { ...w, active: !currentActive } : w))
      );
      toast.success(
        !currentActive ? "Webhook activated" : "Webhook deactivated"
      );
    } catch {
      toast.error("Failed to update webhook");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/settings/webhooks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete webhook");
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success(`"${name}" deleted`);
    } catch {
      toast.error("Failed to delete webhook");
    }
  };

  const toggleEvent = (eventId: WebhookEvent) => {
    setFormEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
    // Clear events error on interaction
    if (formErrors.events) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.events;
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ct-muted">
          Manage webhook endpoints for real-time event notifications.
        </p>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8">
              <Plus className="size-3.5 mr-1.5" />
              Add Webhook
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white rounded-xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-ct-navy">Add Webhook</DialogTitle>
              <DialogDescription className="text-ct-muted">
                Configure a new webhook endpoint to receive event notifications.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Name
                </Label>
                <Input
                  placeholder="e.g. Slack Notification"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formErrors.name) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.name;
                        return next;
                      });
                    }
                  }}
                  className="h-9"
                />
                {formErrors.name && (
                  <p className="text-xs text-red-500">{formErrors.name}</p>
                )}
              </div>

              {/* URL */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Endpoint URL
                </Label>
                <Input
                  placeholder="https://example.com/webhook"
                  value={formUrl}
                  onChange={(e) => {
                    setFormUrl(e.target.value);
                    if (formErrors.url) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.url;
                        return next;
                      });
                    }
                  }}
                  className="h-9"
                />
                {formErrors.url && (
                  <p className="text-xs text-red-500">{formErrors.url}</p>
                )}
              </div>

              {/* Events */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Events
                </Label>
                <div className="grid grid-cols-1 gap-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event.id}
                      className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-ct-cloud transition-colors"
                    >
                      <Checkbox
                        checked={formEvents.has(event.id)}
                        onCheckedChange={() => toggleEvent(event.id)}
                      />
                      <span className="text-sm text-ct-navy">
                        {event.label}
                      </span>
                      <span className="text-xs text-ct-muted ml-auto font-mono">
                        {event.id}
                      </span>
                    </label>
                  ))}
                </div>
                {formErrors.events && (
                  <p className="text-xs text-red-500">{formErrors.events}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
                className="text-xs h-8"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs h-8"
              >
                {submitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Create Webhook
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      {/* Webhook List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2 p-4 border rounded-xl">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12">
          <Globe className="size-10 text-ct-muted mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium text-ct-navy">No webhooks configured</p>
          <p className="text-xs text-ct-muted mt-1">
            Add a webhook to start receiving real-time event notifications.
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[480px] overflow-y-auto">
          {webhooks.map((webhook) => {
            const isExpanded = expandedIds.has(webhook.id);
            return (
              <div
                key={webhook.id}
                className="border rounded-xl p-4 bg-white hover:shadow-sm transition-shadow"
              >
                {/* Webhook Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-ct-navy truncate">
                        {webhook.name}
                      </h4>
                      {webhook.lastDeliveryStatus && (
                        <span className="shrink-0">
                          {webhook.lastDeliveryStatus === "success" ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : webhook.lastDeliveryStatus === "failed" ? (
                            <XCircle className="size-3.5 text-red-500" />
                          ) : (
                            <Loader2 className="size-3.5 text-amber-500 animate-spin" />
                          )}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs text-ct-muted font-mono mt-0.5 truncate"
                      title={webhook.url}
                    >
                      {truncateUrl(webhook.url)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={webhook.active}
                      onCheckedChange={() => handleToggle(webhook.id, webhook.active)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-ct-muted hover:text-red-500"
                      onClick={() => handleDelete(webhook.id, webhook.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Event Badges */}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {webhook.events.map((event) => (
                    <Badge
                      key={event}
                      variant="secondary"
                      className="text-[10px] font-medium bg-ct-cloud text-ct-slate border-0"
                    >
                      {getEventLabel(event)}
                    </Badge>
                  ))}
                  {!webhook.active && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium text-ct-muted border-ct-muted/30"
                    >
                      Inactive
                    </Badge>
                  )}
                </div>

                {/* Delivery Logs Toggle */}
                {webhook.deliveryLogs && webhook.deliveryLogs.length > 0 && (
                  <button
                    onClick={() => toggleExpanded(webhook.id)}
                    className="flex items-center gap-1 mt-2.5 text-xs text-ct-muted hover:text-ct-navy transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    Recent deliveries ({webhook.deliveryLogs.length})
                  </button>
                )}

                {/* Delivery Logs */}
                {isExpanded && webhook.deliveryLogs && (
                  <div className="mt-2 space-y-1.5 border-t pt-2.5">
                    {webhook.deliveryLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between text-xs py-1"
                      >
                        <div className="flex items-center gap-2">
                          {log.success ? (
                            <CheckCircle2 className="size-3 text-emerald-500" />
                          ) : (
                            <XCircle className="size-3 text-red-500" />
                          )}
                          <span className="text-ct-muted">
                            {new Date(log.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${getStatusCodeColor(log.statusCode)}`}
                        >
                          {log.statusCode}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}