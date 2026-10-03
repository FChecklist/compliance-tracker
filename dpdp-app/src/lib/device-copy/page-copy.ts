// The one decision the app makes about where a page comes from: the server when it answers, the copy on this device when the NETWORK does
// not. A real refusal from the server is never replaced by old data. Pure (every side effect is passed in), so `bun test` covers it.
import type { CopyStore, StoredPage } from "./copy-store"

type WithRows = { rows: Array<{ due: Date } & Record<string, unknown>> } & Record<string, unknown>

export function toStored<P extends WithRows>(page: P): StoredPage {
  return { ...page, rows: page.rows.map((r) => ({ ...r, due: r.due.toISOString() })) } as unknown as StoredPage
}

export function fromStored<P extends WithRows>(stored: StoredPage): P {
  return { ...stored, rows: stored.rows.map((r) => ({ ...r, due: new Date(r.due) })) } as unknown as P
}

export type PageSource<P, C> = { page: P; clients: C[]; source: "server"; savedAt: null } | { page: P; clients: C[]; source: "device"; savedAt: string }

/**
 * Fetch from the server and keep a copy; or, if the network is down and a copy exists, serve the copy. Throws the server's own error when
 * there is nothing to fall back to, or the error is a refusal rather than a network failure.
 */
export async function loadWithCopy<P extends WithRows, C>(args: {
  fetchPage: () => Promise<P>
  fetchClients: () => Promise<C[]>
  store: CopyStore | null
  email: string | null
  org: string | null
  isNetwork: (e: unknown) => boolean
}): Promise<PageSource<P, C>> {
  const { fetchPage, fetchClients, store, email, org, isNetwork } = args
  try {
    const [page, clients] = await Promise.all([fetchPage(), fetchClients().catch(() => [] as C[])])
    if (store && email) store.saveSnapshot(email, org, toStored(page), clients).catch(() => { /* no room or no IndexedDB: the page still works online */ })
    return { page, clients, source: "server", savedAt: null }
  } catch (e) {
    if (store && email && isNetwork(e)) {
      const snap = await store.loadSnapshot(email, org).catch(() => null)
      if (snap) return { page: fromStored<P>(snap.page), clients: snap.clients as C[], source: "device", savedAt: snap.savedAt }
    }
    throw e
  }
}
