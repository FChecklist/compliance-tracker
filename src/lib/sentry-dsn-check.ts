// V2-10 (Super Boss v2 plan, CSV row #10 "Monitoring (SENTRY_DSN)"), 2026-07-20.
//
// The three Sentry configs (sentry.server.config.ts / sentry.edge.config.ts /
// src/instrumentation-client.ts) all call Sentry.init with a DSN straight
// from process.env, and -- by Sentry's own design -- Sentry.init with an
// undefined dsn safely no-ops rather than throwing. That is the right
// posture for a codebase whose owner hasn't provisioned a DSN yet (free
// tier, sentry.io, an Owner/Vercel-dashboard action, not an agent action:
// see sentry.server.config.ts's header comment + the plan's C17 note).
//
// The gap this closes is the *visibility* half: with a no-op SDK and no
// other signal, a misconfigured deploy silently ships with zero error
// monitoring and nobody knows. This check runs once at server startup
// (wired from src/instrumentation.ts's register() hook) and logs a single
// warning naming the missing var(s) so the absence is observable in the
// Vercel log stream the moment a build starts without the secret -- the
// "logs a warning if missing" requirement from the plan, without touching
// the Sentry configs themselves (constraint: read-only on Sentry config
// except the check).
//
// Pure + dependency-free so it can be unit-tested without importing
// @sentry/nextjs or the db client: it takes the env and a logger by
// argument, and returns the structured result. The wiring caller
// (instrumentation.ts) supplies process.env and console.warn.

export type SentryDsnCheckResult = {
  /** True when at least one expected DSN var is missing/blank. */
  missing: boolean;
  /** Names of the missing vars (subset of SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN). */
  missingVars: string[];
};

const EXPECTED_VARS = ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"] as const;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Inspect the env for the two Sentry DSN vars the codebase's Sentry configs
 * consume. Returns whether any are missing; does not throw or otherwise
 * affect the SDK (Sentry.init already no-ops on an undefined dsn). Pure.
 */
export function checkSentryDsnEnv(
  env: Record<string, string | undefined> = process.env,
): SentryDsnCheckResult {
  const missingVars = EXPECTED_VARS.filter((name) => isBlank(env[name]));
  return { missing: missingVars.length > 0, missingVars };
}

/**
 * Run checkSentryDsnEnv and log a single warning if any DSN var is missing.
 * Intended to be called once at server startup (see src/instrumentation.ts).
 * Silent when both vars are set -- the "silent when set" half of the plan's
 * done criteria. Idempotent in effect: a missing var logs every call, but
 * the wiring point calls it exactly once per boot.
 */
export function warnIfSentryDsnMissing(
  env: Record<string, string | undefined> = process.env,
  warn: (...args: unknown[]) => void = console.warn,
): SentryDsnCheckResult {
  const result = checkSentryDsnEnv(env);
  if (result.missing) {
    warn(
      `[sentry] SENTRY_DSN startup check: missing ${result.missingVars.join(", ")} -- ` +
        "Sentry SDK will no-op (no error monitoring / alerting). " +
        "Provisioning the DSN is an Owner/Vercel-dashboard action (see ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md C17).",
    );
  }
  return result;
}
