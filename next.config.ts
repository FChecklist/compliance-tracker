import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
};

// PLATFORM-01 Wave 2 (Workstream 5): wires the already-installed-but-
// unwired next-intl package for real. Default request-config path
// (./src/i18n/request.ts) picked up automatically -- no explicit path
// needed. This is "usage without i18n routing" (no /en/, /hi/ URL
// prefixes, no separate locale middleware.ts): locale is resolved from a
// cookie in src/i18n/request.ts, not from the URL segment.
const withNextIntl = createNextIntlPlugin();
const configWithIntl = withNextIntl(nextConfig);

// Gated on SENTRY_ORG/SENTRY_PROJECT being set (not just SENTRY_DSN) --
// withSentryConfig's source-map-upload step needs org/project/auth-token to
// do anything useful; wrapping unconditionally would add a no-op webpack
// plugin to every build before those secrets exist. Runtime error capture
// (instrumentation.ts, instrumentation-client.ts) already works independent
// of this wrapper once SENTRY_DSN alone is set. Composed with (not
// replacing) the next-intl wrapper above -- both are additive webpack/
// config wrappers around the same base nextConfig.
export default process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
  ? withSentryConfig(configWithIntl, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
    })
  : configWithIntl;
