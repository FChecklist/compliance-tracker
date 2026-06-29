"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-navy">
      <Loader2 className="size-8 text-ct-saffron animate-spin" />
    </div>
  );
}

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}