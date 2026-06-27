"use client";

import { useState, useCallback, type FormEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* -------------------------------------------------------------------------- */
/*  Zod field-error shape returned by /api/auth/register                      */
/* -------------------------------------------------------------------------- */
interface ZodFieldError {
  path: string[];
  message: string;
}

interface ApiError {
  error: string;
  code?: string;
  details?: ZodFieldError[];
}

/* -------------------------------------------------------------------------- */
/*  Shared input classnames (light + dark)                                    */
/* -------------------------------------------------------------------------- */
const inputBase =
  "block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";

/* -------------------------------------------------------------------------- */
/*  Spinner SVG                                                               */
/* -------------------------------------------------------------------------- */
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Register Page                                                             */
/* -------------------------------------------------------------------------- */
export default function RegisterPage() {
  const router = useRouter();

  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");

  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  /* ---- helpers ---------------------------------------------------------- */
  const clearErrors = useCallback(() => {
    setServerError(null);
    setFieldErrors({});
  }, []);

  const handleDigitsOnly = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    setPasscode(digits);
  }, []);

  /* ---- submit ----------------------------------------------------------- */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    clearErrors();

    const trimmedOrg = orgName.trim();
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedPasscode = passcode.trim();

    /* ---------- client-side validation ---------- */
    const clientErrors: Record<string, string> = {};

    if (!trimmedOrg) {
      clientErrors.org_name = "Organisation name is required.";
    } else if (trimmedOrg.length < 2) {
      clientErrors.org_name = "Must be at least 2 characters.";
    } else if (trimmedOrg.length > 100) {
      clientErrors.org_name = "Must be 100 characters or fewer.";
    }

    if (!trimmedName) {
      clientErrors.full_name = "Full name is required.";
    } else if (trimmedName.length < 2) {
      clientErrors.full_name = "Must be at least 2 characters.";
    }

    if (!trimmedEmail) {
      clientErrors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      clientErrors.email = "Please enter a valid email address.";
    }

    if (!trimmedPasscode) {
      clientErrors.passcode = "Passcode is required.";
    } else if (!/^\d{4,8}$/.test(trimmedPasscode)) {
      clientErrors.passcode = "Passcode must be 4 to 8 digits.";
    }

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    /* ---------- API call ---------- */
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_name: trimmedOrg,
          full_name: trimmedName,
          email: trimmedEmail,
          passcode: trimmedPasscode,
        }),
      });

      if (res.status === 201) {
        router.push("/login");
        return;
      }

      /* Parse error body */
      let data: ApiError | null = null;
      try {
        data = (await res.json()) as ApiError;
      } catch {
        /* non-JSON response */
      }

      if (data?.details && Array.isArray(data.details)) {
        /* Zod validation errors — map field paths to inline messages */
        const mapped: Record<string, string> = {};
        for (const issue of data.details) {
          const field = issue.path[0] as string;
          if (field) mapped[field] = issue.message;
        }
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
          setServerError(data.error ?? "Please fix the errors below.");
        } else {
          setServerError(data.error ?? "Validation failed. Please check your input.");
        }
      } else if (data?.code === "DUPLICATE_EMAIL") {
        setFieldErrors({ email: data.error });
      } else {
        setServerError(data?.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setServerError("Unable to connect to the server. Check your network and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  /* ---- field-level error helper ---------------------------------------- */
  function fieldError(name: string) {
    return fieldErrors[name];
  }

  function ariaInvalid(name: string) {
    return fieldErrors[name] ? true : undefined;
  }

  function ariaDescribedBy(name: string) {
    return fieldErrors[name] ? `${name}-error` : undefined;
  }

  /* ====================================================================== */
  /*  Render                                                                 */
  /* ====================================================================== */
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div className="w-full max-w-md">
        {/* ---- Branding -------------------------------------------------- */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-lg shadow-blue-600/25">
            CT
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            ComplianceTrack
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            One Portal. One Truth.
          </p>
        </div>

        {/* ---- Card ----------------------------------------------------- */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Create your account
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Get started with ComplianceTrack in minutes.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
            {/* ---- Server / top-level error ------------------------------ */}
            {serverError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
              >
                <span className="font-medium">Error:</span> {serverError}
              </div>
            )}

            {/* ---- Organisation Name ------------------------------------- */}
            <div>
              <label
                htmlFor="org_name"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Organisation Name
              </label>
              <input
                id="org_name"
                type="text"
                autoComplete="organization"
                placeholder="Acme Corp"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  if (fieldErrors.org_name) setFieldErrors((p) => ({ ...p, org_name: "" }));
                }}
                disabled={isLoading}
                aria-invalid={ariaInvalid("org_name")}
                aria-describedby={ariaDescribedBy("org_name")}
                className={inputBase}
              />
              {fieldError("org_name") && (
                <p id="org_name-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldError("org_name")}
                </p>
              )}
            </div>

            {/* ---- Full Name --------------------------------------------- */}
            <div>
              <label
                htmlFor="full_name"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Full Name
              </label>
              <input
                id="full_name"
                type="text"
                autoComplete="name"
                placeholder="Jane Doe"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.full_name) setFieldErrors((p) => ({ ...p, full_name: "" }));
                }}
                disabled={isLoading}
                aria-invalid={ariaInvalid("full_name")}
                aria-describedby={ariaDescribedBy("full_name")}
                className={inputBase}
              />
              {fieldError("full_name") && (
                <p id="full_name-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldError("full_name")}
                </p>
              )}
            </div>

            {/* ---- Email ------------------------------------------------- */}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: "" }));
                }}
                disabled={isLoading}
                aria-invalid={ariaInvalid("email")}
                aria-describedby={ariaDescribedBy("email")}
                className={inputBase}
              />
              {fieldError("email") && (
                <p id="email-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldError("email")}
                </p>
              )}
            </div>

            {/* ---- Passcode ---------------------------------------------- */}
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
                autoComplete="new-password"
                placeholder="4–8 digit code"
                maxLength={8}
                value={passcode}
                onChange={(e) => {
                  handleDigitsOnly(e);
                  if (fieldErrors.passcode) setFieldErrors((p) => ({ ...p, passcode: "" }));
                }}
                disabled={isLoading}
                aria-invalid={ariaInvalid("passcode")}
                aria-describedby={ariaDescribedBy("passcode")}
                className={`${inputBase} tracking-widest placeholder:tracking-normal`}
              />
              {fieldError("passcode") && (
                <p id="passcode-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldError("passcode")}
                </p>
              )}
              {!fieldError("passcode") && (
                <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                  Choose a 4–8 digit numeric passcode.
                </p>
              )}
            </div>

            {/* ---- Submit ------------------------------------------------ */}
            <button
              type="submit"
              disabled={isLoading}
              className="relative flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-blue-500 dark:focus-visible:ring-blue-400/40"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Creating account&hellip;
                </>
              ) : (
                "Create account"
              )}
            </button>
          </form>
        </div>

        {/* ---- Back to login -------------------------------------------- */}
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Already registered?{" "}
          <Link
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Sign in
          </Link>
        </p>

        {/* ---- Footer --------------------------------------------------- */}
        <p className="mt-12 text-center text-xs text-gray-400 dark:text-gray-600">
          &copy; {new Date().getFullYear()} ComplianceTrack. All rights reserved.
        </p>
      </div>
    </div>
  );
}