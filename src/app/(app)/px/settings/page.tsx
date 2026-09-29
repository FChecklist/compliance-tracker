"use client";

// force-dynamic: see src/app/(app)/knowledge-base/page.tsx for why this is
// required (prevents static prerendering + CDN-cache bypass of middleware).
export const dynamic = "force-dynamic";

// PROJEXA server-merge (ai-os/PROJEXA_SERVER_MERGE_PLAN.md), module
// "settings": native port of PROJEXA's own Settings screen
// (FChecklist/projexa src/app/(app)/settings/page.tsx +
// src/components/SettingsClient.tsx). Lives at /px/settings, not
// /settings, because compliance-tracker's own /settings is a different,
// pre-existing product concept under the same URL (this repo's own
// account/organisation/AI-config settings) -- src/proxy.ts (already merged
// separately) rewrites projexa-ai.com/settings to this path so PROJEXA's
// own visitors keep seeing a clean /settings URL.
//
// SCOPE -- 2 of PROJEXA's 8 Settings cards are ported here, not all 8. This
// is not an oversight; it is what "reads the SAME backend routes directly,
// no new backend route" (this migration's own rule) actually allows for
// this page, once each card's real data source is traced:
//
//   PORTED (both have a real, already-existing compliance-tracker native
//   route under src/app/api/v1/projexa/**, read directly here):
//     - Organization Currency  -> GET/PUT /api/v1/projexa/currencies/base
//     - BOQ Categories         -> GET/POST /api/v1/projexa/scope/categories,
//                                 PATCH/DELETE .../scope/categories/[id]
//
//   NOT PORTED (traced individually; none of these six call
//   compliance-tracker at all in PROJEXA's own source -- they read/write
//   PROJEXA's OWN Supabase project, evpckeuxgvahguwsaeul, which this repo
//   has no access to and should not duplicate a second, disconnected copy
//   of):
//     - Organization info (name/slug/created-at) + "Your Account" card --
//       PROJEXA's own `organizations` table (settings-source.ts's
//       getSettingsOrgInfo(), GET /api/organization). compliance-tracker's
//       own equivalent concept (org name, the signed-in user's own
//       role/email) already exists natively on THIS app's own /settings
//       page ("Profile"/"Organisation" sections) -- there is nothing to
//       port here, and building a second one against PROJEXA's org would
//       show a compliance-tracker user PROJEXA's data, which is wrong for
//       a native compliance-tracker session.
//     - Team roster + role editor -- PROJEXA's own `memberships` table
//       (settings-source.ts's getSettingsMembers(), GET/PATCH
//       /api/org-members[/id]). Same reasoning: compliance-tracker's own
//       user/role administration already exists elsewhere in this app
//       (the Users/Team pages), against compliance-tracker's own org.
//     - WorkspaceConnectionCard -- PROJEXA's /api/org/repair, which
//       diagnoses/repairs whether a PROJEXA org has a stored
//       veridian_credentials row (the API key PROJEXA uses to call this
//       app). That concept -- "is this PROJEXA org connected to
//       VERIDIAN" -- is inherent to PROJEXA's own proxy architecture and is
//       meaningless from inside a native compliance-tracker page: there is
//       no "connection to itself" to check or repair here.
//     - OrgInvitesCard -- PROJEXA's own `org_invites` table and its own
//       `/invite/<token>` redemption flow (GET/POST/DELETE
//       /api/org/invites[/id]), scoped to PROJEXA's own memberships. No
//       compliance-tracker route exists for this at all.
//     - GoogleSheetsCard -- PROJEXA's own `googleSheetsIntegration` table
//       and Apps Script bridge (/api/integrations/google-sheets/*). Not a
//       proxy to this app; no compliance-tracker route exists for it, and
//       this task is UI-only (no inventing a new backend route).
//     - DailyDigestCard -- PROJEXA's own `organizations.timezone` /
//       `orgEmailSchedule` table (GET/PUT /api/organization/email-schedule
//       in the PROJEXA repo). Confirmed by reading that route directly: it
//       is a plain Drizzle read/write against PROJEXA's own DB, not a
//       callVeridian() proxy. No compliance-tracker route exists for it.
//
// Verified by grepping this repo's src/app/api/v1/projexa/** and
// src/app/api for "google-sheets", "email-schedule" and "digest" -- no
// matching route exists for either of the last two cards' data.
//
// UI is compliance-tracker's own shadcn Card/Table/Select/Button (matching
// the house convention every already-ported construction-* page uses --
// see permits/page.tsx, construction-dashboard/page.tsx), not PROJEXA's
// @fchecklist/veridian-ui-kit ScreenFrame/ListScreen. Porting the DATA and
// BEHAVIOUR from SettingsClient.tsx/BoqCategoriesCard.tsx faithfully,
// including the per-row uncontrolled-<Input>-with-revert-epoch rename
// pattern (see renameCategory below) -- rebuilding the component tree in
// compliance-tracker's own vocabulary.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type BaseCurrency = { id: string; code: string; name: string; symbol: string | null };
type OrgCurrency = { baseCurrency: BaseCurrency | null; country: string | null };
type BoqCategory = { id: string; name: string; sortOrder: number; isActive: boolean };

// Mirrors src/lib/services/erp-accounting-service.ts's own CURRENCY_NAMES
// (the codes VERIDIAN already knows a display name for) -- same curated set
// PROJEXA's SettingsClient.tsx used, for the same reason: this product's
// real markets are India + the Gulf, and a free-text currency field invites
// a typo an org would then be silently mis-denominated by. setBaseCurrency()
// creates the erp_currencies row for a code the org doesn't hold yet, so any
// of these ten is always a valid choice regardless of what the org already
// has on file.
const CURRENCY_OPTIONS: { code: string; name: string }[] = [
  { code: "AED", name: "UAE Dirham" },
  { code: "INR", name: "Indian Rupee" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "OMR", name: "Omani Rial" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "KWD", name: "Kuwaiti Dinar" },
];

// Roles that GET /api/v1/projexa/currencies/base's own PUT gates on
// (requireRoleOrScope(ctx, "admin", "write")) via src/lib/supabase/
// role-rank.ts's ROLE_RANK: rank >= 5 is "admin" or "veridian_admin". This
// is a UX affordance only -- hides a control the caller couldn't use -- the
// real gate is server-side on the route itself, same as PROJEXA's own
// CAN_ASSIGN_ROLES convention it mirrors.
const CURRENCY_ADMIN_ROLES = new Set(["admin", "veridian_admin"]);

// Roles BELOW the BOQ-category write gate (requireRoleOrScope(ctx,
// "member", "write"), rank >= 2) -- viewer/client_viewer/external_auditor/
// stage_0 all rank 1. Everyone else (member and up) may write.
const BELOW_MEMBER_RANK_ROLES = new Set(["viewer", "client_viewer", "external_auditor", "stage_0"]);

export default function PxSettingsPage() {
  const [role, setRole] = useState<string | null>(null);

  const [currency, setCurrency] = useState<OrgCurrency | null>(null);
  const [currencyLoading, setCurrencyLoading] = useState(true);
  const [savingCurrency, setSavingCurrency] = useState(false);

  const [categories, setCategories] = useState<BoqCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null);
  // Bumped for ONE row when its rename is refused; see renameCategory's catch.
  const [revertEpoch, setRevertEpoch] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setRole(typeof d?.role === "string" ? d.role : null))
      .catch(() => {});
  }, []);

  const canEditCurrency = role !== null && CURRENCY_ADMIN_ROLES.has(role);
  const canEditCategories = role !== null && !BELOW_MEMBER_RANK_ROLES.has(role);

  useEffect(() => {
    fetch("/api/v1/projexa/currencies/base")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setCurrency(d); })
      .catch(() => {})
      .finally(() => setCurrencyLoading(false));
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const res = await fetch("/api/v1/projexa/scope/categories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load BOQ categories");
      setCategories(data.categories ?? []);
      setCategoriesError(null);
    } catch (err) {
      setCategoriesError(err instanceof Error ? err.message : "Couldn't load BOQ categories");
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  async function changeCurrency(code: string) {
    setSavingCurrency(true);
    try {
      const res = await fetch("/api/v1/projexa/currencies/base", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update currency");
      setCurrency(data);
      toast.success(`Organization currency set to ${data.baseCurrency?.code ?? code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update currency");
    } finally {
      setSavingCurrency(false);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setAddingCategory(true);
    try {
      const res = await fetch("/api/v1/projexa/scope/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't add this category");
      setNewCategoryName("");
      await loadCategories();
      toast.success(`"${data.name ?? name}" added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add this category");
    } finally {
      setAddingCategory(false);
    }
  }

  async function renameCategory(category: BoqCategory, nextName: string) {
    const name = nextName.trim();
    if (!name || name === category.name) return;
    setBusyCategoryId(category.id);
    try {
      const res = await fetch(`/api/v1/projexa/scope/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't rename this category");
      await loadCategories();
      const moved = typeof data.lineItemsUpdated === "number" ? data.lineItemsUpdated : 0;
      toast.success(moved === 0 ? `Renamed to "${name}"` : `Renamed to "${name}" — ${moved} BOQ line${moved === 1 ? "" : "s"} updated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename this category");
      // Put the field back to the name the server still holds, so the screen
      // and the database cannot silently disagree. loadCategories() ALONE
      // CANNOT DO THIS: a refusal leaves the stored name unchanged, so the
      // reloaded row is identical, React reuses the same element, and an
      // uncontrolled <Input> keeps whatever DOM value it already had (the
      // rejected text) -- defaultValue is only read at mount. Bumping this
      // row's revert counter changes its key, forcing a remount that
      // re-applies defaultValue. Per-row on purpose: a refusal here must not
      // discard text someone is part-way through typing in another row.
      setRevertEpoch((m) => ({ ...m, [category.id]: (m[category.id] ?? 0) + 1 }));
      await loadCategories();
    } finally {
      setBusyCategoryId(null);
    }
  }

  async function removeCategory(category: BoqCategory) {
    setBusyCategoryId(category.id);
    try {
      const res = await fetch(`/api/v1/projexa/scope/categories/${category.id}`, { method: "DELETE" });
      const data = await res.json();
      // The refusal ("Used by 12 BOQ lines") is the server's own wording and
      // is shown verbatim -- it names the exact reason and the exact count,
      // which a generic failure message would throw away.
      if (!res.ok) throw new Error(data.error ?? "Couldn't delete this category");
      await loadCategories();
      toast.success(`"${category.name}" removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete this category");
    } finally {
      setBusyCategoryId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-ct-navy">Settings</h1>
        <p className="text-sm text-ct-muted mt-1">Organization currency and BOQ categories for construction projects.</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base font-semibold text-ct-navy">Organization Currency</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-ct-muted">
            The currency construction contract values, BOQ amounts and budgets are reported in.
          </p>
          {currencyLoading ? (
            <p className="text-sm text-ct-muted" aria-busy="true">Loading…</p>
          ) : canEditCurrency ? (
            <Select value={currency?.baseCurrency?.code ?? ""} onValueChange={changeCurrency} disabled={savingCurrency}>
              <SelectTrigger size="sm" className="w-36"><SelectValue placeholder="Not set" /></SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="font-medium text-ct-navy">{currency?.baseCurrency?.code ?? "Not set"}</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader><CardTitle className="text-base font-semibold text-ct-navy">BOQ Categories</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-ct-muted">
            The categories offered on every BOQ line, and grouped by the Work Progress Report&apos;s Category-wise tab.
          </p>
          {categoriesError && <p role="alert" className="text-[13px] text-red-600">{categoriesError}</p>}
          {categoriesLoading ? (
            <p className="text-sm text-ct-muted" aria-busy="true">Loading…</p>
          ) : categories.length === 0 && !categoriesError ? (
            <p className="text-sm text-ct-muted">No categories yet.</p>
          ) : (
            <ul className="space-y-2">
              {categories.map((c) => (
                // Keyed on id + stored name + revert counter -- see
                // renameCategory's catch for why both are needed.
                <li key={`${c.id}:${c.name}:${revertEpoch[c.id] ?? 0}`} className="flex items-center gap-2">
                  <Input
                    aria-label={`Category name: ${c.name}`}
                    className="max-w-[240px] h-9"
                    defaultValue={c.name}
                    disabled={!canEditCategories || busyCategoryId === c.id}
                    onBlur={(e) => renameCategory(c, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                  {canEditCategories && (
                    <Button variant="outline" size="sm" disabled={busyCategoryId === c.id} onClick={() => removeCategory(c)}>
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditCategories && (
            <div className="flex items-center gap-2 pt-1">
              <Input
                aria-label="New category name"
                className="max-w-[240px] h-9"
                placeholder="Add a category"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }}
              />
              <Button size="sm" disabled={addingCategory || newCategoryName.trim() === ""} onClick={addCategory}>
                {addingCategory ? <Loader2 className="size-4 mr-1 animate-spin" /> : null} Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
