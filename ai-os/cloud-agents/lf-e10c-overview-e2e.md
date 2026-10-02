# Package lf-e10c-overview-e2e (laptop app, repo projexa): dashboard, reports and analysis offline, in a real browser

Read `lf-e9-COMMON.md` and `PREAMBLE.md`. Branch `claude/lf-e10c-overview-e2e` from `origin/main`.

## Requirement (owner)
"The whole software works on the laptop with no internet and with our server down", and the figures a person sees must be the figures of THEIR data as per THEIR role. The dashboard, reports, the analysis hub (exceptions, project 360) and the module list/navigation of the on-laptop shell are computed from the laptop's own database. None has been run in a browser.

## Your area
Overview cluster (`shell/clusters/overview.ts`): `/dashboard`, `/dashboard/project`, `/reports`, `/analysis`, `/analysis/exceptions`, `/analysis/project-360`. Screens/adapters: `DashboardLocalScreen`, `dashboard-adapter.ts`, `ReportsLocalScreen`, `AnalysisHubScreen`, `analysis-adapter.ts`, `ExceptionsLocalScreen`, `Project360LocalScreen`, `OverviewBody`. Also the shell itself: `LocalShell`, the module list (`module-list-source`), project switching, the connectivity marker, the "not on this laptop yet" fallback for routes no cluster registers, deep links and the browser Back/Forward buttons offline.

## Do
Steps of `lf-e10a-delivery-e2e.md` that apply (stub in `e2e/support/lf-overview-stub.ts`; a seeded organisation with several projects and kinds, one project the person may NOT read), and: (1) every figure on the dashboard/reports/analysis equals a value you COMPUTE independently in the test from the seeded rows (totals, counts, percentages, delayed activities, over-budget projects): assert exact numbers; (2) role visibility: money figures are absent/blank for a role below the money rank and present for a manager, a project the person cannot read never appears (not in the switcher, not in a total); (3) the figures change when the stub's `/changes` brings a new row online (the dashboard refreshes without a reload) and after an offline edit made through another screen; (4) navigation: every entry of the shell's module list opens (or falls through to the server when online / shows the calm fallback offline), deep links work after a reload offline, Back/Forward work, an unknown route never crashes; (5) large data: seed ~5,000 rows across kinds and assert the dashboard becomes interactive within a budget you measure and record (long tasks < 200 ms during typing in a filter box; the existing `boq-worker-filter.spec.ts` is the pattern); (6) console hygiene as in e10a; (7) accessibility smoke with `@axe-core/playwright` if it is already a dependency (do not add dependencies): no serious/critical violations on each of these screens.

## Deliverables
`e2e/lf-overview-*.spec.ts`, `e2e/support/lf-overview-*.ts`, app fixes with tests, and a table of each figure and how the test computed it.
