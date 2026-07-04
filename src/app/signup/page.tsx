"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          organisation,
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
                </div>

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