import * as Sentry from "@sentry/nextjs";

// Client-side counterpart to sentry.server.config.ts/sentry.edge.config.ts.
// NEXT_PUBLIC_SENTRY_DSN (not SENTRY_DSN) since this bundle ships to the
// browser -- same safe-no-op-without-DSN behavior.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
