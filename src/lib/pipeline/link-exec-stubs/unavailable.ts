// PROJEXA-BUILD-002 WP-09b: what every stub of the ai-work-link-exec bundle throws. See scripts/awl-exec-aliases.mjs for why these stubs exist and
// which real module each one stands in for. The message carries a closed code and the module's name, never a value, so the intent's failure code
// (which comes from the ServiceError or the thrown error class, not this text) cannot leak anything.
export const NOT_AVAILABLE_ON_EXEC = "NOT_AVAILABLE_ON_EXEC"

export function unavailable(what: string): never {
  throw new Error(`${NOT_AVAILABLE_ON_EXEC}: ${what} is not part of the ai-work-link-exec bundle`)
}

/** A function that throws when called: the shape of every stubbed export. */
export const thrower =
  (what: string) =>
  (..._args: unknown[]): never =>
    unavailable(what)
