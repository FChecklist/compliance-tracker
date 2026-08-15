// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Design
// Pattern Consistency, Low): "Patterns are convention-enforced, not
// compiler/lint-enforced." CLAUDE.md already states "All API routes MUST
// call requireAuth() from @/lib/supabase/auth-guard" -- this rule makes
// that pattern lint-visible instead of relying purely on review/memory.
//
// Deliberately a WARNING, never an error (see eslint.config.mjs's severity
// for this rule, and do not change it without re-reading this comment): a
// real repo-wide scan at the time this rule was added found 825 of 878
// route.ts files already call requireAuth()/requireAuthOrApiKey()/
// validateApiKey() directly, but the other 53 are legitimate, intentional
// exceptions -- pre-auth flows (passcode login, SSO ACS/login), public
// token-based access (client-portal/[token], esignature sign/[token],
// guest-chat/[token]), public contact/forge forms, health checks, and
// internal cron-triggered routes protected by a different mechanism. `eslint
// .` runs in CI (.github/workflows/ci.yml's `lint` job, required by
// `build`) with no `--max-warnings` flag, so ESLint's default behavior
// (warnings do not fail the run, only errors do) is load-bearing here --
// an "error" severity would immediately fail CI repo-wide for every
// concurrently in-flight PR over files this rule was never meant to
// gate, which is exactly the kind of disproportionate blast radius this
// gap-closure pass is trying to avoid, not cause.
//
// Only checks for the *name* of a real auth-guard call appearing anywhere
// in the route file's text (not that it's actually invoked correctly, not
// that its result is checked) -- same class of guarantee as this repo's
// other guardrail-presence checks (see scripts/check-guardrail-presence.mjs
// and AGENTS.md Rule 9's own stated honest limitation): a reviewable
// signal, not a runtime-unbypassable lock. A file intentionally skipping
// auth should have a comment saying why (grep the 53 example exceptions
// above for the established pattern), not just silently omit the call.
const AUTH_CALL_PATTERN = /\b(requireAuth|requireAuthOrApiKey|validateApiKey)\s*\(/;

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "API route files should call requireAuth()/requireAuthOrApiKey()/validateApiKey(), or document why they intentionally do not.",
    },
    schema: [],
    messages: {
      missingAuthGuard:
        "This route file has no requireAuth()/requireAuthOrApiKey()/validateApiKey() call. If this route is intentionally public (pre-auth flow, token-based public access, health check, etc.), add a comment explaining why -- see the ~53 existing exceptions (client-portal/[token], esignature sign/[token], guest-chat/[token], health, auth/passcode-login, ...) for the established pattern. Otherwise, see CLAUDE.md: \"All API routes MUST call requireAuth() from @/lib/supabase/auth-guard\".",
    },
  },
  create(context) {
    return {
      Program(node) {
        const text = context.sourceCode ? context.sourceCode.getText() : context.getSourceCode().getText();
        if (!AUTH_CALL_PATTERN.test(text)) {
          context.report({ node, messageId: "missingAuthGuard" });
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "require-auth-in-api-routes": rule,
  },
};

export default plugin;
