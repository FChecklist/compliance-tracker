import * as Sentry from "@sentry/nextjs";

// Safe no-op until SENTRY_DSN is configured (Sentry.init with an undefined
// dsn disables the SDK rather than throwing) -- account creation is a step
// the repo owner does themselves (free tier, sentry.io), not something an
// agent does on their behalf. See docs/infra/TOOL_INTEGRATION_PLAN.md's
// Sentry backlog item.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
