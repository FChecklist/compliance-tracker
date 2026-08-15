import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// VERIDIAN Review Framework gap-closure (Accessibility / Visual
// Accessibility, 2026-07-18): eslint-config-next/core-web-vitals only
// wires up 6 jsx-a11y rules at "warn" (alt-text, aria-props,
// aria-proptypes, aria-unsupported-elements, role-has-required-aria-props,
// role-supports-aria-props). This adds the full jsx-a11y "recommended"
// ruleset (anchor-is-valid, label-has-associated-control,
// click-events-have-key-events, heading-has-content, html-has-lang, etc.)
// as a real CI gate -- placed after nextCoreWebVitals/nextTypescript in
// the array so its "error" severities win over Next's "warn" duplicates
// (later entries override earlier ones in flat config). This prevents
// *future* a11y regressions; it does not retroactively catch every
// existing icon-only-button-missing-an-accessible-name case (jsx-a11y has
// no rule for that -- accessible-name computation for arbitrary icon
// children isn't statically decidable) -- that class of gap was fixed by
// a one-time manual sweep in this same PR instead (see PROGRESS.md).
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  // Spread jsx-a11y's own "recommended" rule severities only -- NOT its
  // `plugins` key, which would collide ("Cannot redefine plugin
  // 'jsx-a11y'") with the jsx-a11y plugin instance nextCoreWebVitals
  // already registers under the same name.
  rules: { ...jsxA11y.flatConfigs.recommended.rules },
}, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // eslint-plugin-react-hooks v7's new React Compiler rule -- flags the
    // standard "fetch in useEffect, setState when the async load() resolves"
    // pattern used by virtually every page in this app (confirmed via a
    // minimal repro: even a single useState+single fetch+single setState
    // trips it), so enforcing it as an error would require rewriting every
    // existing data-fetching page. Matches the same rationale as the two
    // rules above it.
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",

    // jsx-a11y (added 2026-07-18 alongside the recommended ruleset above):
    // enabling the full recommended set as a hard CI gate surfaced ~35
    // pre-existing violations of these 6 rules, scattered across ~15 files
    // this task's 2 findings (color contrast, icon aria-labels) never
    // touched -- real gaps (custom div-based dropdowns/menus missing
    // keyboard handlers, labels not wired to their control's id/htmlFor),
    // but fixing them means auditing each interactive widget's keyboard
    // behavior individually, which is its own separately-scoped follow-up,
    // not a drive-by in an unrelated PR. Downgraded to "warn" (visible in
    // `bun run lint`, doesn't fail CI) rather than "off", so the gate still
    // catches *new* instances of everything else in the recommended set at
    // full "error" severity. Matches this file's own existing precedent
    // just above (react-hooks/set-state-in-effect) for a rule that's
    // right in principle but too broad to fix in the PR that adds it.
    "jsx-a11y/label-has-associated-control": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/no-noninteractive-element-interactions": "warn",
    "jsx-a11y/interactive-supports-focus": "warn",
    // Opinionated rather than a hard WCAG failure (SC 2.4.3 lets a page
    // manage initial focus deliberately) -- 3 existing uses are legitimate
    // UX (MFA code input, inline-edit field autofocus), off rather than warn.
    "jsx-a11y/no-autofocus": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "public/litert-spike/wasm/**", "public/litert-spike-embeddings/wasm/**"]
}];

export default eslintConfig;
