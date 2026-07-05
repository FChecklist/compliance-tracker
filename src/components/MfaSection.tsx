"use client";

// Wave 97 (Comparison CSV 3 gap analysis: IAM003 "MFA Enrollment"). Real
// Supabase Auth TOTP factors (auth.mfa.enroll/challenge/verify/unenroll) --
// no custom OTP secret storage or verification logic here at all. Once a
// factor is verified, middleware.ts's AAL2 gate requires the /mfa-challenge
// step on every future session before any protected route is reachable.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Factor = { id: string; friendlyName: string | null; status: string; createdAt: string };

export default function MfaSection() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      setFactors(data.totp.map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, status: f.status, createdAt: f.created_at })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadFactors(); }, [loadFactors]);

  async function startEnroll() {
    setEnrolling(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error || !data) {
      toast.error(error?.message ?? "Failed to start enrollment");
      setEnrolling(false);
      return;
    }
    setQrCode(data.totp.qr_code);
    setPendingFactorId(data.id);
  }

  async function confirmEnroll() {
    if (!pendingFactorId || code.trim().length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setVerifying(true);
    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId });
    if (challengeError || !challenge) {
      toast.error(challengeError?.message ?? "Failed to challenge factor");
      setVerifying(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: pendingFactorId, challengeId: challenge.id, code: code.trim() });
    setVerifying(false);
    if (verifyError) {
      toast.error(verifyError.message);
      return;
    }
    toast.success("Two-factor authentication enabled");
    setQrCode(null);
    setPendingFactorId(null);
    setCode("");
    setEnrolling(false);
    loadFactors();
  }

  async function removeFactor(id: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Authenticator removed");
    loadFactors();
  }

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-ct-muted" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ct-muted">
        Require a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) at sign-in, in addition to your password.
      </p>

      {factors.filter((f) => f.status === "verified").length > 0 ? (
        <div className="space-y-2">
          {factors.filter((f) => f.status === "verified").map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-white border border-ct-border">
              <ShieldCheck className="size-4 text-ct-teal shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-ct-navy">{f.friendlyName || "Authenticator App"}</span>
                <Badge variant="secondary" className="ml-2 text-[9px]">active</Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-ct-muted hover:text-ct-error" onClick={() => removeFactor(f.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : qrCode ? (
        <div className="space-y-3 max-w-sm">
          <p className="text-xs text-ct-muted">Scan this QR code with your authenticator app, then enter the 6-digit code it generates.</p>
          <img src={qrCode} alt="TOTP QR code" className="w-40 h-40 border border-ct-border rounded-lg" />
          <div className="flex gap-2">
            <Input inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center tracking-widest" />
            <Button onClick={confirmEnroll} disabled={verifying}>{verifying ? <Loader2 className="size-4 animate-spin" /> : "Confirm"}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={startEnroll} disabled={enrolling} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
          {enrolling ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
          Enable Two-Factor Authentication
        </Button>
      )}
    </div>
  );
}
