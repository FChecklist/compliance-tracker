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

## Remaining
- [ ] Extend `PreAuthBrand` interface + `resolvePreAuthBrandByHost()`
      (org-branding-service.ts) with `tagline`
- [ ] Update org-branding-service.test.ts for the new field
- [ ] Fix /pricing (split into async Server Component + client component,
      wordmark, hero subtitle via tagline, FAQ answer, CTA banner, footer)
- [ ] Fix /contact (wordmark, generateMetadata title, footer)
- [ ] Fix /terms + /privacy via shared LegalShell (wordmark, generateMetadata
      title, footer attribution line) -- leave substantive legal body prose
      unchanged (names the real legal entity/product bundle, not host-brand
      dependent)
- [ ] Bonus (near-zero extra cost since LegalShell becomes brand-aware
      anyway): wire /data-policy through the same optional `brand` prop for
      consistency with /terms + /privacy
- [ ] `bunx tsc --noEmit` clean, `bun run lint` clean, `bun test` green
- [ ] Commit + push, open PR, update ACTIVE-CLAIMS to recently_completed
