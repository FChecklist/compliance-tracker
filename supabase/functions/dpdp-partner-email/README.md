# dpdp-partner-email

Sales Partner emails (drizzle/0674). Deploy with `--no-verify-jwt`: the cron presents the Vault secret `dpdp_timer_secret` as the bearer, the same as `dpdp-monday-email`. The Owner's payout screen calls it with the Owner's own JWT (checked with `dpdp__is_platform_admin()`).

| Job | Body | Who calls | What it does |
|---|---|---|---|
| flush | `{"job":"flush"}` | pg_cron `dpdp-partner-mail` every 30 minutes; the Owner's screen after marking a payout paid | sends every waiting notice in `dpdp.partner_notice` (5 tries each) |
| statements | `{"job":"statements"}` (optional `"period":"2026-09"`) | pg_cron `dpdp-partner-statements`, the 11th, 03:30 UTC | queues last month's statement for each partner with activity (once per partner per month), then flushes |

Mail class is `partner` (`[VERIDIAN DPDP · Partner]`, Reply-To `dpdp+prt.<ref>@`), from the one public address. Every email goes to the partner only and carries counts and amounts: never a client's name, never a payout detail. Test-domain addresses are skipped. With no `RESEND_API_KEY` (or `"dryRun":true`) nothing is sent or marked.

Files to deploy: `index.ts`, `flush.ts`, `render.ts`, `../_shared/mail-outbound.ts`, `../_shared/mail-taxonomy.ts`. Tests: `src/lib/services/dpdp-partner-email.test.ts` (bun, from the repository root).
