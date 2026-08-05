# PROGRESS -- task-20260805-185202-ocid-020-gtm-cert-addendum--fix-pre-auth

Parent: UMR-20260802-165606-4413 (OCID-020). Per PM instruction
UMR-20260805-142048-4edb item 6: /pricing, /contact, /terms, /privacy still
render hardcoded VERIDIAN wordmark/tagline/footer text instead of resolving
per-host brand (same root-cause class as PR #886 login-merged, PR #954
signup/mfa-challenge-open, but broader -- PreAuthBrand needs a real,
scoped extension for tagline; /pricing is a materially larger per-string
copy pass per PR #954's own commit message).

## Completed
- [x] Registered ACTIVE-CLAIMS entry
- [x] Confirmed hardcoded VERIDIAN wordmark/title/footer in /pricing,
      /contact, /terms, /privacy via source read
- [x] Confirmed `product_branches.tagline` DB column already exists
      (unused) -- no new migration needed, just needs selecting +
      exposing on `PreAuthBrand`

- [x] Extended `PreAuthBrand` interface + `resolvePreAuthBrandByHost()`
      (org-branding-service.ts) with `tagline: string | null` (backed by the
      pre-existing, previously-unused `product_branches.tagline` column --
      no migration needed)
- [x] Updated org-branding-service.test.ts: fixture + 2 new tests
      (tagline passthrough when set, `null` not `undefined` when unset)
- [x] Fixed /pricing: split into async Server Component (page.tsx) + client
      component (pricing-client.tsx, unchanged behavior otherwise) --
      wordmark, hero subtitle (`brand.tagline` when set), FAQ
      "Is my data secure on ..." question+answer (built as a function of
      the resolved brand label, not a static const), bottom CTA banner
      sentence, footer copyright
- [x] Fixed /contact: added headers()+resolvePreAuthBrandByHost() (already
      an async Server Component), generateMetadata() title, wordmark
      (nav + footer, single brand-name form when resolved -- no
      "COGNITIVE AI OS" subtitle fabricated for a non-VERIDIAN brand),
      footer copyright
- [x] Fixed /terms + /privacy via shared LegalShell (now takes an optional
      `brand` prop): wordmark, generateMetadata() title, footer attribution
      line ("{brand} is owned and operated by {legalName}..."). Left every
      substantive legal-body paragraph unchanged -- those name the real
      legal entity/product bundle, not the visiting host's brand
- [x] Bonus (near-zero extra cost since LegalShell became brand-aware
      anyway, and it's the same shared component one click away from
      /terms + /privacy): wired /data-policy through the same optional
      `brand` prop for consistency -- not itself named in this gap's scope
- [x] `bun install` (fresh node_modules), `NODE_OPTIONS=--max-old-space-size=4096
      bunx tsc --noEmit` clean (pre-existing scripts/*.ts + sentry.*.ts
      env-type noise, unrelated to any file this change touches), `bun run
      lint` 0 errors (3 pre-existing warnings, unrelated files), `bun test`
      2514 pass / 0 fail across 223 files (fresh run, whole suite green --
      no pre-existing-failure baseline needed)
- [ ] Commit + push, open PR, update ACTIVE-CLAIMS to recently_completed
