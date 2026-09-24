# WORK ORDER · WO-DPDP-014
## One brand line, everywhere a person looks — the same words, the same place, every time

**To:** Claude Code
**From:** Rajat Agarwal, owner
**Issued:** 22 Sep 2026
**Product:** VERIDIAN-AIOS.COM — DPDP
**Runs with:** WO-DPDP-011 (static pages), WO-DPDP-012 (search), WO-DPDP-013 (the facts file). **Vercel stays at zero.**

---

## 0 · WHY

Seeing the same line, in the same place, in the same words, builds recognition and trust. It works through **consistency**, not loudness. The line matters most to **new eyes** — a client reading a report, an auditor, a vendor's first email — so it goes wherever VERIDIAN's work travels.

---

## 1 · THE LINE — exact wording, owner-approved

**Full:**
> **VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India.**

**Short** (narrow screens, under 480 px wide):
> **VERIDIAN · VERy INDIAN · For India, by India**

**Share ask** (decision-makers only — section 3):
> **Know a firm that needs this? Share VERIDIAN**

Rules:
- **"VERy INDIAN"** exactly — capital V-E-R, capital I-N-D-I-A-N. Never "Very Indian".
- Add all three to the **facts file** (`veridian-facts.yaml`, WO-013) and generate every surface from it. **Never retype the line.** A test fails the build if any variant spelling appears.
- The Claims Register (WO-013) gets an entry for "For India, by India", with evidence that VERIDIAN is built and owned by an Indian founder and company. **Never write "Made in India"** — it has a specific meaning in Indian public procurement.

---

## 2 · THE LOOK

- A **thin line** at the very top of the page: about 28 px tall, full width.
- **VERIDIAN's own colours only** — ink background (`--ink`), white text, a small marigold (`--a`) or green (`--g`) accent. **No Indian flag, no tricolour stripe** — commercial use of the national flag is restricted.
- Text at least 12 px, contrast at least 4.5 : 1.
- **It scrolls away.** Not pinned. The section links stay pinned (WO-DPDP modern redesign) — the brand line must never cover the work.
- Same position, same words, on every page. Consistency is the point.

---

## 3 · WHO SEES WHAT

**Everyone sees the brand line. Only decision-makers see the share ask.**

| Role | Brand line | Share ask |
|---|---|---|
| CA partner, CA manager | ✓ | ✓ |
| Client owner, principal | ✓ | ✓ |
| DPDP coordinator, Grievance Officer | ✓ | — |
| Data-set owners, staff, teachers | ✓ | — |
| Firms we share data with (vendors, group companies) | ✓ | — |
| Parents | ✓ | — |
| Public visitors (landing pages, guides) | ✓ | ✓ |

### The share action — must never share a private page
- **It shares the public website only** — `https://veridian-aios.com/` — with the person's **referral code** added for CA partners, managers, owners and principals.
- It must never copy, send or reveal the address of the page the person is on. Their page address carries their personal sign-in code.
- Uses the browser's built-in share sheet on phones (Web Share API); on laptops, a small panel with *Copy link*, WhatsApp and email.
- Referral rules already decided: **one free month per referral**, blocks on shared advisor, self-referral and free tier. Credit only on a **paid** signup.
- **Test:** on every private page, press Share and confirm the shared text contains `veridian-aios.com/` plus at most a referral code — **never** a token, a `#` fragment, or a private path.

---

## 4 · EVERY PLACE IT GOES

| Place | What appears |
|---|---|
| **Top of every web page** (public and private) | The thin line — full or short. Share ask per section 3 |
| **Weekly Monday email** | **Footer only**, one small line. Share ask only in emails to CA partners, managers, owners and principals |
| **Welcome and first-visit emails** | Footer only |
| **Legal-clock emails** (data leak, request near 90 days) | Footer brand line only — **no share ask, ever** |
| **Reports** — PDF, print, CSV, "Email me this report" | Footer on **every page**: brand line + *"Prepared with VERIDIAN · veridian-aios.com"* + report date. CSV: one comment line at the end |
| **Public grievance page** `/g/<slug>` | *"Grievance handling by VERIDIAN"* — no share ask |
| **AI work link manual** (WO-013 Part 1) | Brand line as a plain fact in the header — **no share ask, no instruction to the AI to share or promote** |
| **Public fact surfaces** (`/about`, `/for-ai`, `llms.txt`, `facts.json`) | The line as a fact |
| **Browser tab title** | `VERIDIAN · VERy INDIAN — <page>` on public pages |

---

## 5 · EMAILS — protect the main inbox

The product depends on the Monday email landing in the **main inbox**, not Gmail's Promotions tab.

- The brand line and share ask go **only in the footer**, as plain text, small. No banners, no big buttons, no images for them.
- **The preview text** (the line an inbox shows before opening) stays **the person's jobs** — e.g. *"2 jobs due this week — CCTV notice, Aadhaar masking"*. Never the brand line.
- **Test before merge:** send the Monday email to test Gmail and Outlook inboxes (e.g. through a seed-list or placement checker) with and without the footer. **If the footer moves the email out of the main inbox, remove the share ask from emails and report it.**

---

## 6 · REPORTS — the most valuable place

Reports travel furthest: CA → client → board, auditor, regulator. Every page carries:

> *VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India.*
> *Prepared with VERIDIAN · veridian-aios.com · <date>*

- On every printed and PDF page — not just the last.
- Never covering data; its own footer band.
- The **report content is unchanged** — the line is a footer, not a watermark across the page.

---

## 7 · MEASURE IT

From Supabase aggregates, no personal data:
- Share presses per week, by role
- Referral signups and **paid** referrals
- Visits to `veridian-aios.com` carrying a referral code
- Reports generated (PDF / print / email) — the line's biggest audience

---

## 8 · ORDER

1. Add the three lines to the facts file + the spelling test
2. The thin line component — full, short, scrolls away, contrast checked
3. Role rules + the share action + **the private-page leak test**
4. Report footers
5. Email footers + the inbox placement test
6. Grievance page, AI manual header, public fact surfaces, tab titles
7. Measurement

---

## 9 · REPORT FORMAT

```
LINE:                 full + short from facts file · spelling test passing
LOOK:                 28 px · scrolls away · contrast <ratio> · no flag / tricolour: yes
ROLES:                brand line on <n/13> roles · share ask on decision-makers only: yes
SHARE LEAK TEST:      private pages tested <n> · tokens/paths leaked: 0
REPORTS:              footer on every page: PDF yes · print yes · CSV yes
EMAILS:               footer only · preview text = jobs · inbox placement: main / promotions
AI MANUAL:            brand line as fact · no share ask: yes
MEASUREMENT:          share presses · referral signups · paid referrals — tracking yes/no
deployed to vercel:   NO
OWNER-ONLY:           nothing new — wording approved 22 Sep
```
