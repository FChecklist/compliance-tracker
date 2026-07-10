import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
};

// Gated on SENTRY_ORG/SENTRY_PROJECT being set (not just SENTRY_DSN) --
// withSentryConfig's source-map-upload step needs org/project/auth-token to
// do anything useful; wrapping unconditionally would add a no-op webpack
// plugin to every build before those secrets exist. Runtime error capture
// (instrumentation.ts, instrumentation-client.ts) already works independent
// of this wrapper once SENTRY_DSN alone is set.
export default process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
    })
  : nextConfig;
