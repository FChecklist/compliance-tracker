"use client";

// Priority 14 Wave 2 (GAP-AUTH-REBUILD): Settings surface for the additive
// 4-digit return-login passcode -- set/change/remove only, all through
// requireAuth()-gated /api/settings/passcode. Deliberately no "view current
// passcode" affordance (only a bcrypt hash is ever stored server-side, so
// there is nothing to show) and no "forgot passcode" link here -- a
// forgotten passcode is recovered by signing in the normal way (magic-link/
// Google/password/SSO, whichever this account already uses) and coming
// back here to set a new one. Mirrors MfaSection.tsx's reveal-a-small-form
// interaction pattern for the same Settings > Security tab.
import { useEffect, useState, useCallback } from "react";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type PasscodeStatus = { hasPasscode: boolean; setAt: string | null };

export default function PasscodeSection() {
  const [status, setStatus] = useState<PasscodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/passcode");
      if (res.ok) setStatus(await res.json());
    } catch {
      // Non-fatal -- the section just shows its "set a passcode" empty state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function savePasscode() {
    if (!/^\d{4}$/.test(passcode)) {
      toast.error("Passcode must be exactly 4 digits");
      return;
    }
    if (passcode !== confirmPasscode) {
      toast.error("Passcodes do not match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, confirmPasscode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to set passcode");
        return;
      }
      toast.success(status?.hasPasscode ? "Passcode updated" : "Passcode set");
      setPasscode("");
      setConfirmPasscode("");
      setEditing(false);
      loadStatus();
    } catch {
      toast.error("Failed to set passcode");
    } finally {
      setSaving(false);
    }
  }

  async function removePasscode() {
    setRemoving(true);
    try {
      const res = await fetch("/api/settings/passcode", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to remove passcode");
        return;
      }
      toast.success("Passcode removed");
      loadStatus();
    } catch {
      toast.error("Failed to remove passcode");
    } finally {
      setRemoving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ct-muted">
        Set a 4-digit passcode for faster sign-in on return visits. This is optional and never replaces your normal sign-in method
        (magic link, Google, password, or SSO) -- those remain required for your first sign-in and are the only way to recover your
        account if you forget your passcode.
      </p>

      {status?.hasPasscode && !editing ? (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-ct-border">
          <KeyRound className="size-4 text-ct-teal shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-medium text-ct-navy">Passcode enabled</span>
            <Badge variant="secondary" className="ml-2 text-[9px]">active</Badge>
            {status.setAt && (
              <p className="text-xs text-ct-muted mt-0.5">
                Set on {new Date(status.setAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-ct-muted hover:text-ct-navy" onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-ct-muted hover:text-ct-error" onClick={removePasscode} disabled={removing}>
            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        </div>
      ) : editing || !status?.hasPasscode ? (
        <div className="space-y-3 max-w-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">New Passcode</Label>
              <Input
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="text-center tracking-widest"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-ct-muted uppercase">Confirm</Label>
              <Input
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="text-center tracking-widest"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={savePasscode} disabled={saving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
              {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <KeyRound className="size-4 mr-2" />}
              {status?.hasPasscode ? "Update Passcode" : "Set Passcode"}
            </Button>
            {status?.hasPasscode && (
              <Button variant="ghost" onClick={() => { setEditing(false); setPasscode(""); setConfirmPasscode(""); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
