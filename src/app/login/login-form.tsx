"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function LoginForm() {
  const t = useTranslations("Login");
  const tAuth = useTranslations("Auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/home";
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSso, setShowSso] = useState(false);
  const [ssoOrgSlug, setSsoOrgSlug] = useState("");

  // Priority 14 Wave 2 (GAP-AUTH-REBUILD): additive 4-digit return-login
  // passcode, built ADDITIVE alongside every existing method above, never
  // replacing them -- a returning user who already opted in from Settings
  // (PasscodeSection.tsx) can sign in with email+passcode instead of
  // waiting for a magic link. First-time signup still requires magic-link/
  // Google/password/SSO; there is no passcode-based signup or recovery
  // path (see src/lib/passcode-login-service.ts's header for the full
  // security writeup). showPasscode gates a separate 4-digit input rather
  // than repurposing the password field above, so this never gets
  // confused with the real password flow in handleLogin.
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcode, setPasscode] = useState("");

  // Wave 59: SAML SSO entry point. Multi-tenant SSO needs to know which
  // org's IdP to redirect to before any credentials exist -- asking for
  // the org's slug here (matching this app's own existing use of `slug`
  // as the public org identifier) is the simplest honest discovery step,
  // rather than inferring it from an email domain this app doesn't map
  // to an org today.
  const handleSsoLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssoOrgSlug.trim()) return;
    window.location.href = `/api/auth/sso/${encodeURIComponent(ssoOrgSlug.trim())}/login`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error(error.message);
      // Fire-and-forget: feeds the repeated-failed-auth Tier-1 monitor
      // (src/lib/services/auth-failure-service.ts). Never blocks the error
      // toast on this, and never reveals anything beyond what the toast
      // above already does.
      fetch("/api/auth/failure-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, method: "password" }),
      }).catch(() => {});
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  // Priority 8 (14-priority8-close-tree1-remaining-gaps.yaml, GAP-AUTH-
  // REBUILD / D28.B3.S1, G-045): "Google sign-in as 1st option" -- built
  // ADDITIVE, alongside the existing password/magic-link/SSO options, never
  // replacing them (a full auth-method rebuild on a live product with real
  // user sessions was explicitly ratified against as too hard-to-reverse
  // for this pass -- see MASTER-TRACKER.yaml). The existing
  // /auth/callback route already handles ANY provider's PKCE code exchange
  // generically (exchangeCodeForSession works the same for magic-link and
  // OAuth) -- confirmed by reading it before adding this, no changes needed
  // there. Honest limitation: this button is only actually usable once a
  // Google OAuth client is configured in the Supabase project's Auth
  // settings (Owner/dashboard action, same class of gap as
  // GITHUB_DISPATCH_PAT -- not something this session can configure).
  const handleGoogleSignIn = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
    // On success, Supabase redirects the browser to Google -- no further
    // client-side action here.
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      toast.error(t("magicLinkEmailRequired"));
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success(t("magicLinkSent"));
    setLoading(false);
  };

  // Priority 14 Wave 2 (GAP-AUTH-REBUILD): POST /api/auth/passcode-login
  // verifies email+passcode server-side (rate-limited, bcrypt-compared --
  // see passcode-login-service.ts) and, on success, returns a Supabase
  // admin-minted magic-link `actionLink` -- the exact same
  // session-establishment mechanism the existing SSO button
  // (handleSsoLogin below) and a real clicked magic-link email both
  // resolve through (/auth/callback's PKCE exchange). Navigating the
  // browser there (not just fetching it) is what actually lets Supabase's
  // Set-Cookie response land on this origin.
  const handlePasscodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error(t("magicLinkEmailRequired"));
      return;
    }
    if (!/^\d{4}$/.test(passcode)) {
      toast.error(t("passcodeInvalidFormat"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/passcode-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), passcode, redirectTo }),
      });
      const data = await res.json();

      if (!res.ok || !data.actionLink) {
        toast.error(data.error ?? t("passcodeLoginFailed"));
        setLoading(false);
        return;
      }

      window.location.href = data.actionLink;
    } catch {
      toast.error(t("passcodeLoginFailed"));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background */}
      <div className="flex-1 flex items-center justify-center bg-gradient-navy relative overflow-hidden">
        {/* Decorative blurs */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 size-72 rounded-full bg-ct-saffron blur-3xl" />
          <div className="absolute bottom-10 right-10 size-96 rounded-full bg-ct-teal blur-3xl" />
        </div>

        <div className="relative w-full max-w-md px-4">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-4">
              <img src="/logo-mark.svg" alt="VERIDIAN AI" className="size-11 rounded-xl" />
              <span className="font-heading text-2xl text-white">
                VERIDIAN AI
              </span>
            </div>
            <p className="text-white/60 text-sm">
              {tAuth("tagline")}
            </p>
          </div>

          {/* Login Card */}
          <Card className="rounded-2xl shadow-xl border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-semibold text-ct-navy text-center">
                {t("welcomeBack")}
              </CardTitle>
              <p className="text-sm text-ct-muted text-center">
                {t("subtitle")}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {errorParam && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 text-center">
                  {t("authFailed")}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                className="w-full h-10 gap-2"
                disabled={loading}
                onClick={handleGoogleSignIn}
              >
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
                  <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.26a12 12 0 0 0 0 10.73l4.01-3.09Z" />
                  <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.63l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
                </svg>
                {t("signInWithGoogle")}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-ct-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-ct-muted">{t("or")}</span>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold text-ct-muted uppercase">
                    {t("emailLabel")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-semibold text-ct-muted uppercase">
                      {t("passwordLabel")}
                    </Label>
                    <button
                      type="button"
                      className="text-xs text-ct-saffron hover:underline"
                      onClick={handleMagicLink}
                    >
                      {t("sendMagicLink")}
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t("passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : null}
                  {loading ? t("signingIn") : t("signIn")}
                </Button>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-ct-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-ct-muted">{t("or")}</span>
                </div>
              </div>

              {/* Priority 14 Wave 2 (GAP-AUTH-REBUILD): passcode entry
                  point -- same reveal-on-click pattern as the SSO block
                  right below, additive alongside it, never replacing the
                  password/magic-link/Google/SSO options above. */}
              {showPasscode ? (
                <form onSubmit={handlePasscodeLogin} className="space-y-2">
                  <Label htmlFor="passcode" className="text-xs font-semibold text-ct-muted uppercase">
                    {t("passcodeLabel")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="passcode"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder={t("passcodePlaceholder")}
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      className="h-10 text-center tracking-widest"
                    />
                    <Button type="submit" variant="outline" className="h-10 shrink-0" disabled={loading}>
                      {loading ? <Loader2 className="size-4 animate-spin" /> : t("continue")}
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="w-full text-center text-sm text-ct-muted hover:text-ct-navy hover:underline"
                  onClick={() => setShowPasscode(true)}
                >
                  {t("signInWithPasscode")}
                </button>
              )}

              {/* SSO entry point */}
              {showSso ? (
                <form onSubmit={handleSsoLogin} className="space-y-2">
                  <Label htmlFor="ssoOrgSlug" className="text-xs font-semibold text-ct-muted uppercase">
                    {t("companyIdLabel")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="ssoOrgSlug"
                      placeholder={t("companyIdPlaceholder")}
                      value={ssoOrgSlug}
                      onChange={(e) => setSsoOrgSlug(e.target.value)}
                      className="h-10"
                    />
                    <Button type="submit" variant="outline" className="h-10 shrink-0">{t("continue")}</Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="w-full text-center text-sm text-ct-muted hover:text-ct-navy hover:underline"
                  onClick={() => setShowSso(true)}
                >
                  {t("signInWithSso")}
                </button>
              )}

              {/* Signup CTA */}
              <p className="text-center text-sm text-ct-muted">
                {t("noAccount")}{" "}
                <Link
                  href="/signup"
                  className="text-ct-saffron font-medium hover:underline"
                >
                  {t("createOne")}
                </Link>
              </p>
            </CardContent>
          </Card>

          {/* Footer */}
          <p className="text-center text-xs text-white/40 mt-6">
            {tAuth("footer")}
          </p>
          <div className="mt-3 flex justify-center">
            <LanguageSwitcher className="text-[11px] bg-white/10 border border-white/20 rounded-md px-1.5 py-0.5 text-white/70" />
          </div>
        </div>
      </div>
    </div>
  );
}