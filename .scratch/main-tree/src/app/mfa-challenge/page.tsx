"use client";

// Wave 97 (Comparison CSV 3 gap analysis: IAM003 "MFA Enrollment"). Real
// Supabase Auth TOTP challenge -- middleware.ts redirects here whenever a
// session's currentLevel is aal1 but its nextLevel is aal2 (i.e. the user
// has a verified factor enrolled but hasn't completed this session's
// challenge yet). Uses Supabase's own mfa.challengeAndVerify, not a custom
// OTP implementation.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/home";

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error || !data) { setLoading(false); return; }
      const verified = data.totp.find((f) => f.status === "verified");
      setFactorId(verified?.id ?? null);
      setLoading(false);
    });
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.trim().length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center bg-gradient-navy relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 size-72 rounded-full bg-ct-saffron blur-3xl" />
          <div className="absolute bottom-10 right-10 size-96 rounded-full bg-ct-teal blur-3xl" />
        </div>

        <div className="relative w-full max-w-md px-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-4">
              <img src="/logo-mark.svg" alt="VERIDIAN AI" className="size-11 rounded-xl" />
              <span className="font-heading text-2xl text-white">VERIDIAN AI</span>
            </div>
          </div>

          <Card className="rounded-2xl shadow-xl border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-semibold text-ct-navy text-center flex items-center justify-center gap-2">
                <ShieldCheck className="size-5" /> Two-factor verification
              </CardTitle>
              <p className="text-sm text-ct-muted text-center">
                Enter the 6-digit code from your authenticator app
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {loading ? (
                <div className="flex justify-center py-6"><Loader2 className="size-6 animate-spin text-ct-saffron" /></div>
              ) : !factorId ? (
                <p className="text-sm text-ct-error text-center">No verified authenticator found. Contact your administrator.</p>
              ) : (
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="code" className="text-xs font-semibold text-ct-muted uppercase">Authentication Code</Label>
                    <Input
                      id="code" inputMode="numeric" maxLength={6} placeholder="000000"
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      className="h-10 text-center text-lg tracking-widest" autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full h-10 bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron" disabled={submitting}>
                    {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                    {submitting ? "Verifying..." : "Verify"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function MfaChallengePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gradient-navy"><Loader2 className="size-8 text-ct-saffron animate-spin" /></div>}>
      <MfaChallengeForm />
    </Suspense>
  );
}
