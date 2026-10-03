// "Is this failure the network, or the server saying no?" Only a network failure may fall back to the copy on the device: a real refusal
// (no membership, not allowed) must still be shown as a refusal, never papered over with old data.

const NETWORK_WORDS = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network connection was lost|timeout|timed out|err_internet/i

export function isNetworkError(e: unknown, onLine: boolean | undefined = typeof navigator === "undefined" ? undefined : navigator.onLine): boolean {
  if (onLine === false) return true
  if (e instanceof TypeError) return true
  const code = (e as { code?: unknown } | null)?.code
  // PostgREST / Postgres refusals carry a code; a bare browser failure does not.
  if (typeof code === "string" && code !== "") return false
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : ""
  return NETWORK_WORDS.test(msg)
}
