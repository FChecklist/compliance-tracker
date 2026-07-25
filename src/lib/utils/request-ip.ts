// Shared by every public, pre-auth route that needs the caller's IP for
// rate-limiting/audit purposes (failure-event/route.ts, passcode-login/
// route.ts) -- this exact x-forwarded-for-split / x-real-ip-fallback logic
// was previously duplicated verbatim in both. Returns undefined rather than
// a default so callers preserve their own existing fallback semantics
// (e.g. `getRequestIp(request) ?? "unknown"`).
export function getRequestIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  )
}
