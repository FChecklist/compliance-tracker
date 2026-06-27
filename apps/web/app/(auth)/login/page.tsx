"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedPasscode = passcode.trim();

    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (!trimmedPasscode) {
      setError("Please enter your passcode.");
      return;
    }

    if (!/^\d{4,8}$/.test(trimmedPasscode)) {
      setError("Passcode must be 4 to 8 digits.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, passcode: trimmedPasscode }),
      });

      if (!res.ok) {
        let message = "Something went wrong. Please try again.";
        try {
          const body = await res.json();
          if (typeof body?.error === "string") {
            message = body.error;
          }
        } catch {
          /* ignore parse errors */
        }
        setError(message);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Unable to connect to the server. Check your network and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-lg shadow-blue-600/25">
            CT
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            ComplianceTrack
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sign in to your account
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Error alert */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400">
                <span className="font-medium">Error:</span> {error}
              </div>
            )}

            {/* Email field */}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
            </div>

            {/* Passcode field */}
            <div>
              <label
                htmlFor="passcode"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Passcode
              </label>
              <input
                id="passcode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="4–8 digit code"
                maxLength={8}
                value={passcode}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setPasscode(digits);
                }}
                disabled={isLoading}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm tracking-widest text-gray-900 placeholder:tracking-normal placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
              <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                Enter the 4–8 digit passcode sent to your email.
              </p>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="relative flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-blue-500 dark:focus-visible:ring-blue-400/40"
            >
              {isLoading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Create one
          </Link>
        </p>

        {/* Footer */}
        <p className="mt-12 text-center text-xs text-gray-400 dark:text-gray-600">
          &copy; {new Date().getFullYear()} ComplianceTrack. All rights reserved.
        </p>
      </div>
    </div>
  );
}