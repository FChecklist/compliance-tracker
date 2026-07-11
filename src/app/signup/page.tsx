"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, ArrowRight, Loader2, CheckCircle2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type InvitePreview =
  | { valid: true; orgName: string; role: string }
  | { valid: false; reason: string };

type JoinCodePreview =
  | { valid: true; orgName: string; role: string }
  | { valid: false; reason: string };

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Wave 109 (Sales Engine): a /r/[token] redirect appends ?ref=<token> --
  // threaded into signUp()'s options.data so autoProvisionUser() can
  // resolve it into a sales_referrals row at org-creation time.
  const ref = searchParams.get("ref");
  // Wave 113 (VERI Treasure): a /vr/[token] redirect appends ?vref=<token>
  // -- the refer-and-earn counterpart to ref above, resolved into a
  // veri_reward_referrals row instead of sales_referrals.
  const vref = searchParams.get("vref");
  // Area 15/18 (Secure Invite Link): an /invite/[token] redirect appends
  // ?invite=<token> -- threaded into signUp()'s options.data so
  // autoProvisionUser() joins the invite's org/role instead of creating a
  // brand-new organisation for this signup. See invite-link-service.ts.
  const invite = searchParams.get("invite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);

  useEffect(() => {
    if (!invite) return;
    let cancelled = false;
    fetch(`/api/invite/${encodeURIComponent(invite)}`)
      .then((res) => res.json())
      .then((data: InvitePreview) => { if (!cancelled) setInvitePreview(data); })
      .catch(() => { if (!cancelled) setInvitePreview({ valid: false, reason: "not_found" }); });
    return () => { cancelled = true; };
  }, [invite]);

  const hasValidInvite = invitePreview?.valid === true;

  // Area 15 (self-registration via admin code, Path C): a code the user
  // types in themselves, distinct from `invite` above (a link they clicked
  // that pre-fills this same field's counterpart via a URL param). Only
  // offered when there's no invite link already active, to avoid two
  // competing "which org am I joining" signals on one form.
  const [showJoinCodeField, setShowJoinCodeField] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinCodePreview, setJoinCodePreview] = useState<JoinCodePreview | null>(null);

  useEffect(() => {
    const trimmed = joinCode.trim();
    if (trimmed.length < 6) { setJoinCodePreview(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch("/api/join-code/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      })
        .then((res) => res.json())
        .then((data: JoinCodePreview) => { if (!cancelled) setJoinCodePreview(data); })
        .catch(() => { if (!cancelled) setJoinCodePreview({ valid: false, reason: "not_found" }); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [joinCode]);

  const hasValidJoinCode = !hasValidInvite && joinCodePreview?.valid === true;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Wave 113 (Visitor Intelligence): the anonymous visitor id set by the
    // public pages' tracker, so autoProvisionUser() can close the loop from
    // anonymous visit to converted tenant — same mechanism as ref above.
    let vid: string | null = null;
    try { vid = localStorage.getItem("VERIDIAN_VID"); } catch { /* ignore */ }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          organisation,
          ...(ref ? { ref } : {}),
          ...(vid ? { vid } : {}),
          ...(vref ? { vref } : {}),
          ...(hasValidInvite && invite ? { inviteToken: invite } : {}),
          ...(hasValidJoinCode && joinCode ? { orgJoinCode: joinCode.trim() } : {}),
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
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
                <span className="font-heading text-2xl text-white">
                  VERIDIAN AI
                </span>
              </div>
            </div>

            <Card className="rounded-2xl shadow-xl border-0">
              <CardContent className="p-8 text-center space-y-4">
                <div className="mx-auto size-14 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="size-7 text-emerald-600" />
                </div>
                <h2 className="text-xl font-semibold text-ct-navy">
                  Check your email
                </h2>
                <p className="text-sm text-ct-muted leading-relaxed">
                  We&apos;ve sent a confirmation link to{" "}
                  <span className="font-medium text-ct-navy">{email}</span>.
                  Click the link to verify your account and get started.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => router.push("/login")}
                >
                  Back to Sign In
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
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
              One Portal. One Truth.
            </p>
          </div>

          {/* Signup Card */}
          <Card className="rounded-2xl shadow-xl border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-semibold text-ct-navy text-center">
                Create your account
              </CardTitle>
              <p className="text-sm text-ct-muted text-center">
                Start managing compliance in minutes
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName" className="text-xs font-semibold text-ct-muted uppercase">
                    Full Name
                  </Label>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="Rajesh Sharma"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                {hasValidInvite && invitePreview?.valid ? (
                  <div className="flex items-start gap-2.5 rounded-lg bg-ct-teal/10 border border-ct-teal/30 px-3 py-2.5">
                    <Users className="size-4 text-ct-teal mt-0.5 shrink-0" />
                    <p className="text-sm text-ct-navy">
                      You&apos;re joining <span className="font-semibold">{invitePreview.orgName}</span> as{" "}
                      <span className="font-semibold capitalize">{invitePreview.role}</span>.
                    </p>
                  </div>
                ) : hasValidJoinCode && joinCodePreview?.valid ? (
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2.5 rounded-lg bg-ct-teal/10 border border-ct-teal/30 px-3 py-2.5">
                      <Users className="size-4 text-ct-teal mt-0.5 shrink-0" />
                      <p className="text-sm text-ct-navy">
                        You&apos;re joining <span className="font-semibold">{joinCodePreview.orgName}</span> as{" "}
                        <span className="font-semibold capitalize">{joinCodePreview.role}</span>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setJoinCode(""); setJoinCodePreview(null); }}
                      className="text-xs text-ct-muted hover:underline"
                    >
                      Not your organisation? Clear code
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="org" className="text-xs font-semibold text-ct-muted uppercase">
                      Organisation
                    </Label>
                    <Input
                      id="org"
                      type="text"
                      placeholder="Acme Financial Services Pvt. Ltd."
                      value={organisation}
                      onChange={(e) => setOrganisation(e.target.value)}
                      className="h-10"
                    />
                    {invite && invitePreview && !invitePreview.valid && (
                      <p className="text-xs text-ct-error">
                        This invite link is no longer valid ({invitePreview.reason.replace(/_/g, " ")}) -- creating a new organisation instead.
                      </p>
                    )}

                    {showJoinCodeField ? (
                      <div className="pt-2 space-y-1">
                        <Label htmlFor="joinCode" className="text-xs font-semibold text-ct-muted uppercase">
                          Organisation Join Code
                        </Label>
                        <Input
                          id="joinCode"
                          type="text"
                          placeholder="ABCD-EFGH-JKMN"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value)}
                          className="h-10 uppercase"
                        />
                        {joinCode.trim().length >= 6 && joinCodePreview && !joinCodePreview.valid && (
                          <p className="text-xs text-ct-error">
                            {joinCodePreview.reason === "rate_limited"
                              ? "Too many attempts -- please wait a few minutes and try again."
                              : `That code isn't valid (${joinCodePreview.reason.replace(/_/g, " ")}).`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowJoinCodeField(true)}
                        className="text-xs text-ct-saffron font-medium hover:underline"
                      >
                        Have an organisation join code?
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold text-ct-muted uppercase">
                    Work Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-semibold text-ct-muted uppercase">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
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
                  {loading ? "Creating account..." : "Create Account"}
                </Button>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-ct-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-ct-muted">or</span>
                </div>
              </div>

              {/* Login CTA */}
              <p className="text-center text-sm text-ct-muted">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="text-ct-saffron font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>

          {/* Footer */}
          <p className="text-center text-xs text-white/40 mt-6">
            Built for Indian compliance management
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}