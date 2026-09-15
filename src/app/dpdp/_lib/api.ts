"use client"

/** Tiny fetch wrapper for the DPDP UI -- same-origin, cookie-based session, no bearer tokens to manage client-side. */
export async function dpdpFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "include",
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body as T
}
