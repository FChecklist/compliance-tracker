"use client";

// Task #46 (CRM feature-parity gap analysis): one reusable Country/State
// cascading pair of form controls, dropped into any address form in place
// of the free-text Country/State <Input>s -- see src/lib/data/geography.ts
// for the underlying static data and its documented scope decisions
// (Country->State only; City stays free text everywhere).
//
// Deliberately two small, independent components (not one combined widget)
// because every existing address form in this app lays City/State and
// Postal Code/Country out in SEPARATE grid rows (see
// src/app/(app)/crm/accounts/[id]/page.tsx and
// src/components/erp/PartyAddressesAndContacts.tsx) -- Country and State
// are not adjacent in the DOM, only linked by shared component state in the
// parent. A single monolithic component would force a layout change this
// task explicitly forbids. Both components are plain controlled
// value/onValueChange props (no assumed save flow), matching this
// codebase's existing convention of plain useState forms (no
// react-hook-form anywhere in src/app/(app)/) -- callers wire them into
// their own patch-on-change (crm accounts) or draft-then-submit (ERP
// party dialog) pattern exactly as they already do for the Selects/Inputs
// being replaced.
import { COUNTRIES, findCountryByName, findStateByName, getStatesForCountry } from "@/lib/data/geography";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Radix Select rejects an empty-string item value, but every existing
// free-text Input this replaces could always be cleared back to "". This
// sentinel is the one internal detail letting the picker still clear the
// field (onValueChange receives null), preserving that existing capability.
const UNSET = "__unset__";

type CountrySelectProps = {
  value: string | null | undefined;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
};

export function CountrySelect({ value, onValueChange, placeholder = "Country", className, id, disabled }: CountrySelectProps) {
  // A pre-existing free-text value (typed before this component existed,
  // or simply not in our COUNTRIES list) may not match any known country
  // name -- surface it as a one-off extra option instead of silently
  // rendering blank, so dropping this component in never makes existing
  // data look like it vanished.
  const matched = findCountryByName(value);
  const showLegacyValue = !!value && !matched;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onValueChange(v === UNSET ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET} className="text-muted-foreground italic">Not set</SelectItem>
        {showLegacyValue && <SelectItem value={value as string}>{value}</SelectItem>}
        {COUNTRIES.map((c) => (
          <SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type StateSelectProps = {
  /** The currently-selected country NAME (same value CountrySelect emits) --
   *  this is what makes the pair "cascading": the State list is filtered by
   *  whichever country is currently selected. */
  country: string | null | undefined;
  value: string | null | undefined;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
};

// Renders a State/Province Select when static data exists for the selected
// country; otherwise falls back to a plain free-text Input. Most countries
// (see geography.ts's scope-decision comment) have no hardcoded subdivision
// list -- falling back keeps address entry fully usable for them instead of
// blocking on missing data.
export function StateSelect({ country, value, onValueChange, placeholder = "State", className, id, disabled }: StateSelectProps) {
  const states = getStatesForCountry(country);

  if (states.length === 0) {
    return (
      <Input
        id={id}
        className={className}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onValueChange(e.target.value || null)}
        disabled={disabled}
      />
    );
  }

  const matched = findStateByName(country, value);
  const showLegacyValue = !!value && !matched;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onValueChange(v === UNSET ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET} className="text-muted-foreground italic">Not set</SelectItem>
        {showLegacyValue && <SelectItem value={value as string}>{value}</SelectItem>}
        {states.map((s) => (
          <SelectItem key={s.code} value={s.name}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
