/**
 * THE ONE RULE FOR "may this public token still be honoured".
 *
 * Every public, unauthenticated share surface in this product is gated by the
 * same two conditions -- not revoked, not expired -- and until this file
 * existed each one stated them itself:
 *
 *   report-share-service.ts        isShareLinkUsable()  (the only named one)
 *   veri-meeting-service.ts:838    !link || link.revokedAt || link.expiresAt < new Date()
 *   veri-chat-service.ts:107       the same expression again
 *   veri-chat-service.ts:210       and again, for guest access
 *
 * All four were correct. That is the point: a security predicate copied into
 * four places is not wrong today, it is a thing that goes wrong QUIETLY later,
 * when one copy is edited and the others are not. The failure direction here is
 * fail-OPEN -- a resolver that stops checking `revokedAt` keeps serving a link
 * its owner believes they revoked, and nothing errors.
 *
 * These are the only routes in either repo that serve customer data with no
 * authentication of any kind: /share/report/[token], /share/attendance/[token],
 * /shared/mom/[token], /invite/[token], and the guest-chat links. So the rule
 * they share is worth having exactly once.
 *
 * Deliberately dependency-free -- no db, no services, no schema types -- so
 * every service can import it without a cycle, and so it can be unit-tested
 * without a database.
 *
 * TOKEN ENTROPY IS NOT THIS FILE'S JOB and is recorded here because someone
 * will ask: every one of these tokens is `createId()` from
 * @paralleldrive/cuid2 v3.3.0 -- 24 characters over a 36-symbol alphabet,
 * roughly 124 bits, non-sequential by design. That is not the cuid v1 whose
 * ordering made tokens guessable. Checked 2026-09-09 rather than assumed.
 */
export type ShareLinkLifetime = {
  /** Set the moment an owner revokes; null while live. */
  revokedAt: Date | null;
  /** Absolute expiry, always set at creation. */
  expiresAt: Date;
};

/**
 * True only if this link may still be served.
 *
 * `null`/`undefined` returns false so a caller can pass a findFirst result
 * straight in: "no such token" and "token no longer valid" must reach the
 * reader as the same 404, or the response tells an anonymous caller which
 * tokens exist.
 *
 * A TYPE PREDICATE, not a plain boolean, and that is load-bearing. The inline
 * `!link || link.revokedAt || ...` it replaces narrowed `link` to non-null for
 * everything after the throw. A boolean-returning helper would silently take
 * that narrowing away and leave a dozen `possibly undefined` errors, which the
 * next person fixes with `!` -- trading a real check for an assertion. The
 * generic keeps the caller's own row type, so the fields they read after the
 * guard are still theirs.
 */
export function isShareLinkUsable<T extends ShareLinkLifetime>(
  link: T | null | undefined,
  now: Date,
): link is T {
  if (!link) return false;
  if (link.revokedAt) return false;
  return link.expiresAt >= now;
}
