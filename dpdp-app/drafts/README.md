# dpdp-app/drafts -- UNPUBLISHED content, pending lawyer review (WO-DPDP-012 §5)

**Published count: 0.** Nothing in this directory is served, built, linked, crawled
or indexed. It is not under `public/`, not a Vite input, not in `sitemap.xml`,
`robots.txt`, `llms.txt` or `_headers`, and every HTML file carries
`<meta name="robots" content="noindex, nofollow">` plus an `UNPUBLISHED DRAFT`
header comment, so an accidental deploy would still not be indexed.
`src/lib/drafts.test.ts` enforces all of that on every CI run.

WO-DPDP-012 §5, verbatim: *"Build the templates and draft pages; publish nothing
legal until the owner confirms lawyer review. An AI answer quoting a wrong section
number under VERIDIAN's name is worse than no page."*

## What is here

| Path | What | Count |
|---|---|---|
| `jobs/<product>/<key>/index.html` + `index.md` | one page per job in the 59-job library, generated from `data/dpdp-library-0.2-wo010.json` -- never retyped | 59 |
| `guides/<slug>/index.html` + `index.md` | the seven §5 guides, one question each, answer-first | 7 |
| `hi/dpdp-firm/`, `hi/dpdp-institution/` | the two edition landing pages' visible copy, in Hindi (machine draft) | 2 |
| `hi/guides/<slug>/` | the first five guides in Hindi (machine draft), with reciprocal `hreflang` | 5 |
| `INDEX.md` | generated table of contents | 1 |

Every page follows the same contract (§4/§5): `<html lang>`, own `<title>`, meta
description, canonical `https://app.veridian-aios.com/<path>/`, Open Graph, exactly
one `<h1>`, headings in a fixed order, no scripts, no font links, Article +
BreadcrumbList JSON-LD (`author` = VERIDIAN AI, `datePublished`/`dateModified` =
the library's `exportedAt` date for job pages, the drafting date for guides;
`reviewedBy` **omitted** until review exists), the first two sentences answering
the question, the law cited by section and rule, the in-force label ("in force
TODAY, until 13 May 2027" / "in force from 13 May 2027" -- the one page's own
strings from `src/lib/dpdp-onepage/view-model.ts`), who usually does it, what
proof looks like, why it matters, what done looks like, the review line, a plain
disclaimer, and exactly one link ("Track this with VERIDIAN"). No price anywhere.

**`[VERIFY: ...]`** marks are questions for the reviewing lawyer. They are
deliberate: a rule or sub-section number the author was not certain of is flagged
rather than guessed. `grep -r "VERIFY" drafts/` lists every one. A page is not
publishable while one remains.

## Hindi

Machine drafts. Nobody who reads Hindi has reviewed them, and no lawyer has.
The five guides are the first five in the WO's own list (there is no read-count to
rank by before launch -- swap for the real top five once analytics exist). The
landing drafts translate `DpdpMarketingPage.tsx`'s visible copy in section order;
interactive controls appear as their labels, and the rupee penalty band is
omitted because the no-price test forbids `₹` on every draft -- the owner decides
whether the Hindi page keeps that band.

## How to regenerate

Do not hand-edit anything under `drafts/` (except this README). Edit the source and
regenerate; `--check` will otherwise fail in CI.

```
cd dpdp-app
node scripts/generate-job-pages.mjs          # writes every draft (idempotent)
node scripts/generate-job-pages.mjs --check  # exit 1 if drafts != generator output
bun test src/lib/drafts.test.ts              # the contract tests (bun, no install)
```

Plain Node, zero dependencies, not part of `bun run build`.

| To change | Edit |
|---|---|
| a job page's facts | the library export `data/dpdp-library-<version>.json` -- when the lawyer-reviewed library replaces `0.2-wo010`, drop the new export in `data/`, update `LIBRARY_FILE` in `scripts/generate-job-pages.mjs`, regenerate |
| the connective prose on job pages | `scripts/draft-content/jobs.mjs` |
| a law citation, topic label or `[VERIFY]` note | `scripts/draft-content/law.mjs` |
| a guide | `scripts/draft-content/guides.en.mjs` |
| a Hindi guide or landing page | `scripts/draft-content/hi.mjs` |
| the page shell, JSON-LD, disclaimer, review line | `scripts/draft-content/render.mjs` |

## Publish procedure (later -- only after the owner confirms lawyer review)

1. **Review.** The lawyer resolves every `[VERIFY: ...]` (fix the source, not the
   draft) and confirms the pages. A Hindi reader reviews `hi/`.
2. **Record the review.** In `scripts/draft-content/render.mjs` set
   `REVIEW.reviewer` and `REVIEW.date`. Regenerate. In one diff this fills
   "Last reviewed by <lawyer>, <date>", adds `reviewedBy` to the Article JSON-LD,
   and drops the `noindex` meta and the draft banner from every page.
3. **Move into the site.** Copy `drafts/jobs/<product>/<key>/` to
   `public/jobs/<key>/` (the canonical URL is flat: `/jobs/<key>/`, the key already
   carries the product), `drafts/guides/<slug>/` to `public/guides/<slug>/`, and
   `drafts/hi/...` to `public/hi/...`. Keep the `.md` twins beside the HTML
   (§3 wants a Markdown copy of every page).
4. **Public-paths list.** Add `/jobs/`, `/guides/` and `/hi/` to the shared public
   allow-list that `robots.txt`, `_headers` and the crawler settings read from
   (the dpdp-app equivalent of `src/lib/dpdp-public-surface.ts` -- they must say the
   same thing), and make sure `public/_headers` does not `noindex` them.
5. **Sitemap and llms.txt.** Add every published page to `public/sitemap.xml`
   with `lastmod` = its `dateModified`, and list the guides in `public/llms.txt` /
   `public/llms-full.txt` (§3).
6. **hreflang.** The Hindi pages already carry reciprocal `hreflang` tags; confirm
   the English landing pages (`/dpdp-firm/`, `/dpdp-institution/`) get a matching
   `<link rel="alternate" hreflang="hi">` back to `/hi/...`.
7. **Update the test.** `drafts.test.ts` asserts nothing under `drafts/` appears in
   `public/`. Once pages are published, either delete the published drafts and
   make the generator write to `public/` directly, or teach the test which pages
   are now intentionally public -- do not just delete the assertion.
8. Open a PR; CI runs `--check` and the contract tests.
