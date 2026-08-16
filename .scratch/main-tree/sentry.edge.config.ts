import * as Sentry from "@sentry/nextjs";

// Same safe-no-op-without-DSN posture as sentry.server.config.ts.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
