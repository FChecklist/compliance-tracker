import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

// PM decision rows 92 (UMR-20260806-145437-9e9a) + 93 (UMR-20260806-145437-
// 3bed), parent UMR-20260806-101802-a350 (OCID-020 Z.AI GTM tranche 1,
// findings P8-CB-02/P8-CB-03), implemented together as ONE change per both
// rows' own closed_note ("MANDATORY COORDINATION... one worker, one PR,
// both findings closed" / "A CSP frame-ancestors none directive already
// covers what X-Frame-Options DENY does... two independent workers would
// collide on the same file"): projexa-ai.com (served by this repo since the
// Wave 10 DNS/Vercel cutover, ai-os/boss/completed-work/wave10-dns-
// cutover.md) shipped with no Content-Security-Policy and no
// X-Frame-Options/frame-ancestors -- no browser-level XSS mitigation, and
// the real login page could be iframed on an arbitrary domain for
// clickjacking.
//
// REAL ORIGIN ENUMERATION (done live against the deployed site before
// writing this policy, not guessed from the source tree -- curl + reading
// the actual shipped JS across https://projexa-ai.com/, /login, /signup,
// /pricing, since that's genuinely what the browser loads):
//   - All script/style/font assets are self-hosted Next.js chunks
//     (/_next/static/...) -- no third-party script/style/font CDN.
//   - https://pcrjmlpuqsbocqfwoxod.supabase.co -- the real
//     NEXT_PUBLIC_SUPABASE_URL (confirmed both in .env.local and inlined
//     live in the shipped bundle): Supabase Auth (fetch) + Supabase
//     Storage public URLs for org logo/favicon uploads
//     (org-branding-service.ts's getPublicUrl()), so needed in both
//     connect-src and img-src.
//   - https://vercel.live -- Vercel's live-feedback toolbar script; present
//     in the bundle behind a cookie gate (only ever injects in
//     preview/toolbar-enabled contexts), allow-listed so a legitimate
//     preview session isn't silently broken.
//   - https://va.vercel-scripts.com -- @vercel/analytics + @vercel/speed-
//     insights (both actually rendered in src/app/layout.tsx). Production
//     traffic is proxied same-origin (/_vercel/insights/script.js per the
//     bundle's own logic), this domain is only the debug-mode fallback --
//     allow-listed defensively since it's zero real risk to include.
//   - github.com / nextjs.org / react.dev / docs.sentry.io / vercel.com /
//     w3.org / example.com / supabase.com -- all confirmed NOT real fetch
//     targets: doc-link strings in error messages, license comments, or
//     the SVG xmlns namespace. Excluded.
//   - Sentry ingest: NEXT_PUBLIC_SENTRY_DSN is unset in this deployment
//     (bundle ships the unresolved `process.env.NEXT_PUBLIC_SENTRY_DSN`
//     reference, not an inlined literal), so Sentry.init() currently
//     no-ops client-side and there is no real ingest origin in use today.
//     Flagged, not silently omitted: if a DSN is ever configured,
//     connect-src will need the matching *.ingest.sentry.io/us origin
//     added, or client error capture will start failing closed.
//
// GENUINE, DISCLOSED LIMITATION: this enumeration covers every public,
// unauthenticated page (home/login/signup/pricing) but not the full
// authenticated app surface (dashboard, AI copilot, etc.), which needs
// real credentials to crawl and wasn't in scope to verify live here. Per
// the PM decision's own do-not-break-production gate, that's exactly why
// this ships Report-Only rather than enforcing -- nothing on this policy
// blocks a single real request; it only reports. Switching to enforcing
// is a real, separate future step once violations have actually been
// observed (a report collector isn't wired up yet either -- also real
// follow-up work, not done here).
//
// 'unsafe-inline' on script-src is a known, deliberate gap, not an
// oversight: Next.js App Router ships inline `self.__next_f.push(...)` RSC-
// hydration bootstrap scripts on every page, so a policy without it would
// report a violation on literally every page load. Closing that gap for
// real needs a per-request nonce (middleware-generated, wired through the
// root layout via next/headers) -- a genuinely bigger change than "one
// header block", left as explicit follow-up rather than attempted here.
// 'unsafe-inline' on style-src is similarly pragmatic: this repo's UI is
// built on @radix-ui primitives, which apply inline positioning styles
// (transform/position) via JS at runtime for popovers/dropdowns/tooltips
// across the authenticated app -- a near-certain real need, not a guess
// hidden from view.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://pcrjmlpuqsbocqfwoxod.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://pcrjmlpuqsbocqfwoxod.supabase.co https://va.vercel-scripts.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  // PM decision rows 92+93 (see CONTENT_SECURITY_POLICY comment above for
  // the full real evidence/reasoning): Content-Security-Policy-Report-Only
  // (not enforcing yet, per the PM's explicit do-not-break-production
  // gate) plus X-Frame-Options: DENY, which ships enforcing immediately --
  // unlike the CSP, it has no report-only mode and no legitimate use case
  // in this app relies on being framed, so the PM decision treats it as
  // zero-risk to enforce now (frame-ancestors 'none' above duplicates this
  // for modern browsers once the CSP itself is later switched to
  // enforcing; X-Frame-Options is the legacy-browser-covering half of the
  // same fix, per decision three).
  //
  // 2026-09-01 rebase-sweep2b-1202 merge note: a second, independent worker
  // (task-20260815-033857/041523, same governing UMR-20260806-101802-a350)
  // built its own parallel CB-02/CB-03 fix on a different branch, plus a
  // real, distinct P1-OBS-004 finding (X-Content-Type-Options,
  // Referrer-Policy, and Permissions-Policy also absent) -- exactly the
  // duplicate-worker collision the PM decision's own closed_note warned
  // about. Since this repo's copy of the CSP/X-Frame-Options fix already
  // merged, was live-verified, and matches the PM's explicit Report-Only
  // mandate, the other branch's duplicate/more-aggressive enforcing-CSP
  // headers() block was dropped during that merge rather than kept
  // alongside this one (two `headers()` methods on the same object is an
  // invalid duplicate key, and an enforcing CSP was never PM-approved).
  // Its real, non-duplicative contribution -- the 3 extra headers below,
  // closing the separate P1-OBS-004 finding -- was carried forward here.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: CONTENT_SECURITY_POLICY,
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
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
