"use client";

// Priority 17 re-sweep (2026-07-15): shared org-currency display helper for
// compliance-tracker's own (app)/ UI. Several pages independently hardcoded
// "₹"/`.toLocaleString("en-IN")` for genuinely general-business amounts
// (The Firm engagement billing, CRM opportunity value, KPI Hub revenue
// stats, PMS budgets, resource rates) instead of resolving the org's real
// base currency from erp_currencies (the same table PROJEXA's
// /api/v1/projexa/currencies already reads -- this file's native
// equivalent is the existing session-authenticated /api/erp/currencies
// route). NOT used for compliance-tracker's India-statutory amounts (GST
// notices, penalties, Companies Act registers, GST challans) -- those are
// legally INR-denominated regardless of the org's own operating currency
// and were deliberately left untouched; see CONTROLLER.yaml PRIORITY-17
// close_out_2026_07_15 for the full reasoning split.
import { useEffect, useState } from "react";

export type Currency = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };

// R48 gap-closure (2026-08-29, F046: "Org with no currency row does not
// fall back to rupee -- a missing currency row must not silently produce
// rupee"). This previously fell back to "₹" in BOTH the "still loading"
// and "genuinely has no base-currency row" cases -- a real, confirmed
// violation of that requirement (an org with no erp_currencies row at all
// would show every amount as if it were INR, silently, with no signal
// anything was missing). Fixed to return "" (no symbol, just the raw
// number) in both cases instead: this file's own prior comment already
// named the "₹" default as a known INR-only shortcut, not a deliberate
// business rule, so removing it is a real fix, not a behavior change that
// needs new logic elsewhere -- every caller already renders
// `${currencyLabel(...)}${amount}`, so "" degrades to a bare number rather
// than a wrong currency symbol.
//
// id null/undefined means "org base currency".
export function currencyLabel(id: string | null | undefined, currencies: Currency[]): string {
  const c = id ? currencies.find((cur) => cur.id === id) : currencies.find((cur) => cur.isBaseCurrency);
  return c ? `${c.code} ` : "";
}

// Fetch-once-on-mount hook over the existing session-authenticated
// /api/erp/currencies route. Not usable from a public token page (no
// session) -- those fetch the org's base currency code inline as part of
// their own token-scoped API response instead (see client-portal/[token]).
export function useCurrencies(): Currency[] {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  useEffect(() => {
    fetch("/api/erp/currencies").then((r) => r.json()).then((d) => setCurrencies(d.currencies ?? [])).catch(() => {});
  }, []);
  return currencies;
}