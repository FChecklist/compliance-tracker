/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { gapAnswer } from "./dry-run";

// G-23. PROJEXA's composer advertises two worked example sentences per module,
// in the module's own vocabulary, as chips under the input (M24Shell.tsx,
// R67 A-02). Measured 2026-09-09 by joining projexa's MODULE_CATALOGUE against
// ALL_FUNCTION_SPECS in ./function-registry.ts:
//
//     39 modules advertise at least one sentence
//     14 have a registered function on their subject   (28 sentences)
//     25 have NONE                                     (50 sentences)
//
// Half of what the product invites a user to type, it cannot execute. The
// executors are the real fix and this file does not pretend otherwise. What it
// DOES enforce is that the refusal is useful: every advertised sentence the
// pipeline cannot run must still end on the screen it was about, not on
// "Open Home".
//
// WHY THE SENTENCES ARE COPIED HERE rather than imported. They live in the
// OTHER repo (C:/ct/projexa/src/lib/module-catalogue.ts) and this one cannot
// import across that boundary. Copies rot -- so the risk is stated instead of
// hidden: if a sentence below stops matching what PROJEXA advertises, this test
// still passes while the product regresses. The mitigation that does work is
// that a NEW module with no executor fails here the moment its sentences are
// added to this list, and the sentences are quoted verbatim so the drift is
// visible in a diff. A cross-repo generator would be better and is not built.
const ADVERTISED_WITH_NO_EXECUTOR: ReadonlyArray<{ module: string; screen: string; route: string; sentences: string[] }> = [
  { module: "permits", screen: "Permits", route: "/permits", sentences: [
    "add the building permit for Villa 21, expiring 30 Nov",
    "which permits expire in the next 30 days" ] },
  { module: "drawings", screen: "Drawings & 3D", route: "/drawings", sentences: [
    "upload revision C of the ground floor plan",
    "which drawings changed this week" ] },
  { module: "materials", screen: "Material", route: "/materials", sentences: [
    "record 20 bags of cement received today",
    "what is the current stock of TMT bars" ] },
  { module: "vendors", screen: "Vendors", route: "/vendors", sentences: [
    "add a new vendor",
    "which vendors worked on this project" ] },
  { module: "design-studio", screen: "Design Studio", route: "/design-studio", sentences: [
    "log 6 hours of drafting on the villa elevations",
    "show design hours against budget this month" ] },
  { module: "accounting", screen: "Accounting", route: "/accounting", sentences: [
    "post a journal entry for the October site rent",
    "show the trial balance for this quarter" ] },
  { module: "procurement", screen: "Purchase Orders", route: "/purchase-orders", sentences: [
    "raise a purchase order for 200 bags of cement",
    "which purchase orders are still awaiting delivery" ] },
  { module: "invoices", screen: "Invoices", route: "/invoices", sentences: [
    "raise an invoice for the Phase 1 milestone",
    "which invoices are overdue" ] },
  { module: "quotations", screen: "Quotations", route: "/quotations", sentences: [
    "quote the interior fit-out for Cedar Heights",
    "which quotations have not been accepted yet" ] },
  { module: "inventory", screen: "Inventory", route: "/inventory", sentences: [
    "what is on hand across all warehouses" ] },
  { module: "expenses", screen: "Expenses", route: "/expenses", sentences: [
    "claim the site travel expense from Tuesday",
    "which expenses are still unapproved" ] },
  { module: "payroll", screen: "Payroll", route: "/payroll", sentences: [
    "run payroll for September",
    "show the salary structure for site engineers" ] },
  { module: "recruitment", screen: "Recruitment", route: "/recruitment", sentences: [
    "open a vacancy for a quantity surveyor",
    "which applications are waiting on an interview" ] },
  { module: "punch-list", screen: "Punch List", route: "/punch-list", sentences: [
    "log a snag for the cracked tile in unit 4B",
    "how many punch items are still open" ] },
  { module: "rfis", screen: "RFIs", route: "/rfis", sentences: [
    "raise an RFI about the beam reinforcement detail",
    "which RFIs are still unanswered" ] },
  { module: "submittals", screen: "Submittals", route: "/submittals", sentences: [
    "submit the tile sample for approval",
    "which submittals are pending with the consultant" ] },
  { module: "site-diary", screen: "Site Diary", route: "/site-diary", sentences: [
    "record today's site diary entry",
    "show the site diary for last week" ] },
  { module: "ffe", screen: "FF&E", route: "/ffe", sentences: [
    "add the lobby seating to the FF&E schedule",
    "what is the FF&E spend on this project" ] },
  { module: "mood-boards", screen: "Mood Boards", route: "/mood-boards", sentences: [
    "start a mood board for the master bedroom",
    "show the approved mood boards for this project" ] },
  { module: "wiki", screen: "Wiki", route: "/wiki", sentences: [
    "write up the concrete pour method statement" ] },
  { module: "knowledge-base", screen: "Knowledge Base", route: "/knowledge-base", sentences: [
    "add an article on the material approval process",
    "search the knowledge base for retention terms" ] },
  { module: "analysis", screen: "Analysis", route: "/analysis", sentences: [
    "compare planned against actual cost across projects",
    "where is margin slipping this quarter" ] },
];

describe("G-23: an advertised sentence the pipeline cannot run still gets a useful answer", () => {
  test("the fixture is real -- an empty list would pass every assertion below", () => {
    expect(ADVERTISED_WITH_NO_EXECUTOR.length).toBeGreaterThanOrEqual(20);
    expect(ADVERTISED_WITH_NO_EXECUTOR.flatMap((m) => m.sentences).length).toBeGreaterThanOrEqual(40);
  });

  test("*** THE REQUIRED PROOF: none of them lands on Open Home ***", () => {
    // This is the whole point. Before this, nineteen of these modules fell
    // through to "That is not enabled for this workspace yet - Open Home",
    // which sends someone who asked about a permit to the dashboard.
    const shrugged: string[] = [];
    for (const m of ADVERTISED_WITH_NO_EXECUTOR) {
      for (const sentence of m.sentences) {
        const { message, route } = gapAnswer(sentence);
        if (route === "/dashboard" || message.includes("Open Home")) {
          shrugged.push(`${m.module}: "${sentence}" -> ${message}`);
        }
      }
    }
    expect(shrugged, shrugged.join("\n")).toEqual([]);
  });

  test("each sentence is answered with ITS OWN screen, not merely some screen", () => {
    const wrong: string[] = [];
    for (const m of ADVERTISED_WITH_NO_EXECUTOR) {
      for (const sentence of m.sentences) {
        const { message, route } = gapAnswer(sentence);
        if (route !== m.route || !message.includes(m.screen)) {
          wrong.push(`${m.module}: "${sentence}" -> ${route} / ${message}`);
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  test("a creation request says CREATING is what is unavailable, not the screen", () => {
    // "Creating permits from chat is not enabled" tells a user the record can
    // still exist; "that is not enabled" reads as if the feature is missing.
    const { message } = gapAnswer("add the building permit for Villa 21, expiring 30 Nov");
    expect(message).toContain("Creating permits from chat is not enabled");
  });

  test("a question is not answered as though it were a creation request", () => {
    const { message } = gapAnswer("which permits expire in the next 30 days");
    expect(message).not.toContain("Creating");
    expect(message).toContain("Open Permits");
  });

  test("a sentence about nothing recognisable still gets the honest generic answer", () => {
    // The fallback must survive: a gap the list does not know is answered
    // honestly rather than with an invented promise.
    const { message, route } = gapAnswer("qwertyuiop zxcvbnm");
    expect(message).toContain("not enabled for this workspace yet");
    expect(route).toBe("/dashboard");
  });

  test("the more specific phrase wins where two entries could both match", () => {
    // find() returns the FIRST match, so ordering is behaviour. "purchase
    // order" must not be answered by a bare "order" entry, and "site diary"
    // must not be answered as "site".
    expect(gapAnswer("raise a purchase order for 200 bags of cement").route).toBe("/purchase-orders");
    expect(gapAnswer("record today's site diary entry").route).toBe("/site-diary");
  });
});
