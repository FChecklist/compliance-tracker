"use client";

// Priority 18b (Owner directive 2026-07-15, Option B). Design doc section
// 2.1: a lightweight, email-only, passwordless CTA embedded on the two
// existing public token-landing pages (guest-chat/[token],
// shared/conversation/[token]) -- NOT a reuse of login-form.tsx's own
// magic-link button, which passes no options.data (see auth-guard.ts's
// header comment on this exact distinction). This is the one new client
// call site that threads stage0Token into signInWithOtp/signInWithOAuth so
// autoProvisionUser() can see it on the other side of the redirect.
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function Stage0SignupForm({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signUpFree() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          data: { stage0Token: token },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/stage0-chat")}`,
        },
      });
      if (otpError) {
        setError(otpError.message);
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  // Google OAuth: options.data isn't guaranteed to survive an OAuth
  // redirect round-trip the same way signInWithOtp's does (flagged
  // honestly, not assumed, in the design doc section 2.1 -- not fully
  // verified against Supabase's real OAuth metadata behavior). Offered
  // best-effort per the Owner's "gmail" mention; the email/magic-link path
  // above is the fully-verified primary flow.
  async function signUpWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          queryParams: { stage0Token: token },
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/stage0-chat")}`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-xs text-ct-teal font-medium">
        Check your email for a sign-in link -- you'll land in VERI Chat as soon as you click it.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-ct-border bg-ct-cloud/50 p-3">
      <p className="text-xs font-medium text-ct-navy">Sign up free (Stage 0) -- no password, no approval needed</p>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="flex-1 h-8 text-xs rounded-md border border-ct-border px-2"
        />
        <button
          onClick={signUpFree}
          disabled={!email.trim() || loading}
          className="h-8 px-3 rounded-md bg-ct-teal text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
          Sign up free
        </button>
      </div>
      <button onClick={signUpWithGoogle} disabled={loading} className="text-[11px] text-ct-muted underline disabled:opacity-50">
        or continue with Google
      </button>
      {error && <p className="text-xs text-ct-error">{error}</p>}
    </div>
  );
}
