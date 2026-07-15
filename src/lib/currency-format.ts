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

// id null/undefined means "org base currency". Falls back to "₹" only if
// the currencies list hasn't loaded yet or genuinely has no base-currency
// row -- matches this codebase being INR-only in practice today, same
// degradation case PROJEXA's currencyLabel() (fix/currency-symbol-fallback,
// PR #24) already established.
export function currencyLabel(id: string | null | undefined, currencies: Currency[]): string {
  const c = id ? currencies.find((cur) => cur.id === id) : currencies.find((cur) => cur.isBaseCurrency);
  return c ? `${c.code} ` : "₹";
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