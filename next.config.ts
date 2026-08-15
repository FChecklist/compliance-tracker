import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  // veridian-ui-kit migration (2026-07-19): @fchecklist/veridian-ui-kit
  // ships raw .ts/.tsx source directly from its package.json `exports`
  // (a git dependency, not a published/pre-compiled npm package) --
  // Turbopack/webpack don't transpile TypeScript found inside node_modules
  // by default (every other node_modules package ships pre-built JS), so
  // without this the build fails with "Unknown module type" on every one
  // of the package's entry points. transpilePackages opts this one
  // dependency into the same TS/JSX transform this repo's own source gets.
  transpilePackages: ["@fchecklist/veridian-ui-kit"],
  // Priority 21, Layer 2 Workspace Memory
  // (ai-os/priority21_workspace_memory_design.md §2.3/§3.6): @memvid/sdk is
  // a native N-API binding with unconditional top-level requires of its own
  // adapter files (langchain/llamaindex/etc side-effect registrations),
  // even though v1's actual usage (kind: "basic") never executes those
  // adapters' own heavy imports at runtime. Marking it external keeps
  // Next.js's output file tracing/bundler from trying to statically
  // analyze/inline its dynamic requires -- this repo's first use of this
  // option, matching Next.js's own standard guidance for native-binding
  // packages (e.g. sharp).
  serverExternalPackages: ["@memvid/sdk"],
  // Owner mandate task-20260815-033857 (Z.ai real black-box test, Part 8
  // Security report, points P8-CB-02/P8-CB-03, and P1-OBS-004): live
  // `curl -sI` against every page (verified again 2026-08-15) showed
  // strict-transport-security present but content-security-policy,
  // x-frame-options, x-content-type-options, referrer-policy, and
  // permissions-policy entirely absent -- this app previously shipped no
  // headers() config anywhere (grep-confirmed: no vercel.json headers
  // block, no middleware.ts). Applied globally (source: "/(.*)"), not
  // per-route, since the finding covers the whole app including pre-auth
  // pages. CSP is intentionally permissive on script-src/style-src/img-src/
  // connect-src (this app is a large, actively-developing Next.js/Sentry/
  // Supabase/Vercel product with many third-party calls -- see
  // instrumentation-client.ts, org-branding-service.ts's per-tenant
  // asset hosts) rather than a locked-down allowlist that would need a
  // full third-party-origin audit to avoid breaking production; the real
  // security value asserted by CB-02's own finding is frame-ancestors
  // (clickjacking) and object-src/base-uri (classic XSS-adjacent
  // primitives), which this DOES lock down. Re-tightening script-src/
  // connect-src to a real allowlist is a separate, larger follow-up (would
  // need its own dedicated audit of every legitimate external origin this
  // app calls), not silently done here.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
              "style-src 'self' 'unsafe-inline' https:",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https:",
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
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
