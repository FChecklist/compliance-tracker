// Ported from PROJEXA's src/lib/reference-lookups.ts (R80 GAP-8) as part of
// the PROJEXA server-merge recruitment port (ai-os/PROJEXA_SERVER_MERGE_PLAN.md).
// Only soleOptionId is ported -- the only function this module's one call
// site (px/recruitment/applications/new/page.tsx) needs. PROJEXA's own file
// also has loadVendors/invalidateVendors (built on its shell-cache.ts, which
// has no compliance-tracker equivalent) and rememberedOption (no call site in
// this module) -- neither is needed here, so neither is ported, per the
// "port only what's needed" instruction this port follows.
//
// THE RULE THIS FUNCTION ENFORCES, verbatim from the source: only pre-fill a
// value that can be JUSTIFIED from real data. A wrong default on a create
// form is worse than an empty one -- an empty field is visibly the user's to
// answer, whereas a wrong one gets saved.

/** Anything with an id: the shape every reference list in this app shares. */
type Identified = { id: string };

/**
 * The id of the ONLY row, when there is exactly one.
 *
 * The case this answers: an org with exactly one job opening open, or exactly
 * one candidate added so far -- asking somebody to open a dropdown and choose
 * the single thing in it is pure ceremony, since there is no second answer to
 * get wrong. TWO rows is a real question and this returns null for it.
 *
 * A blank or whitespace id is treated as no id -- a select whose value is ""
 * means "nothing chosen" everywhere in this codebase, so seeding one would
 * set a field to the empty answer while looking like it had set something.
 */
export function soleOptionId<T extends Identified>(rows: readonly T[] | null | undefined): string | null {
  if (!rows || rows.length !== 1) return null;
  const id = (rows[0]?.id ?? "").trim();
  return id === "" ? null : id;
}
