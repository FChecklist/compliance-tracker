# DPDP fix programme - running status

Owner's compliance programme for the Veridian DPDP product (started 2026-10-05). Working method does not change: DPDP users work only through the web console/app, the copy-and-paste AI work link, and e-mail. No new channel, app or required step.

The earlier audit (`ai-os/DPDP_COMPLIANCE_AUDIT.md`) was not in git, so the gap list was rebuilt from the owner's brief. Nothing here is applied to a live database or deployed; every live action is listed under LIVE STEPS.

| Wave | PR | What changed | LIVE STEPS still needed |
|---|---|---|---|
| 0 | #2065 (merge on green) | DPDP sign-in e-mail (three options, passcode screen, brand, sign-up screen). Fixed a stale test (billing-mail hostile-name test did not allow the fixed brand span/a markup). | none from this fix |
| 1 | #2071 | Claims made true (AI link page, "added to, not edited", documents/payment proofs); Razorpay and Resend (Tokyo) in Privacy Notice v1.4 and Terms; Board-complaint line and grievance response time; /subprocessors/ page and footer link; AI link hides other people's details by default (migration 0696, response-layer net, planted-identifier test); Grievance Officer by role only. | Apply `drizzle/0696_dpdp_ai_link_hide_emails_default.sql` (rollback `drizzle/down/0696_...down.sql`); `supabase functions deploy dpdp-ai-link`; Cloudflare Pages deploy of dpdp-app. |

Items for the owner (Wave 1): grievance response time wording (reply in 7 days, aim to resolve in 30, outer limit 90) is a new published commitment; confirm Resend region in the Resend dashboard; the Rule 3 reference in the brief was read as "the notice must say how to complain to the Board", so the privacy page links the Board route in words and promises a link once the Board publishes its portal.
