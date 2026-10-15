// The person's copy of their own page on THIS device: the last good answer from dpdp_my_page, and the "Yes, it is done" taps made while
// offline, waiting to be sent. Private by construction:
//   * keyed by the signed-in email, so a second person on a shared laptop never sees the first person's copy;
//   * wipe() on every sign-out removes all of it;
//   * the service worker caches only the app's own code and fonts, never any of this data.
// Honest limit: a queued tap is a request, not a fact. The server decides, stamps the time when it RECEIVES it, and may refuse it.
import type { Kv } from "./kv"

/** Wire shape of a stored page: dates as ISO strings, so the stored form is plain JSON. */
export type StoredPage = { rows: Array<{ id: string; due: string; yes: boolean } & Record<string, unknown>> } & Record<string, unknown>
export type Snapshot = { page: StoredPage; clients: unknown[]; savedAt: string }
export type QueuedTap = { id: string; obligationId: string; queuedAt: string; attempts: number }

const SNAP = "snapshot:"
const OUTBOX = "outbox:"

const norm = (s: string) => s.trim().toLowerCase()
const snapKey = (email: string, org: string | null) => `${SNAP}${norm(email)}|${org ?? "default"}`
const outKey = (email: string, id: string) => `${OUTBOX}${norm(email)}|${id}`
// "Remind me on this device" (reminders.mjs, run by the service worker). The flag is per person and lives only here: keepOnly() drops it when a
// different person signs in, wipe() drops it on sign-out, and the worker reads it straight from this same database.
const remindKey = (email: string) => `remind:${norm(email)}|on`

export type CopyStore = ReturnType<typeof createCopyStore>

export function createCopyStore(kv: Kv, now: () => Date = () => new Date(), newId: () => string = () => crypto.randomUUID()) {
  return {
    async saveSnapshot(email: string, org: string | null, page: StoredPage, clients: unknown[]): Promise<void> {
      await kv.set(snapKey(email, org), { page, clients, savedAt: now().toISOString() } satisfies Snapshot)
    },
    async loadSnapshot(email: string, org: string | null): Promise<Snapshot | null> {
      const s = (await kv.get(snapKey(email, org))) as Snapshot | undefined
      return s && s.page && Array.isArray(s.page.rows) ? s : null
    },
    /** Queue "mark this job done" and show it done in the stored copy straight away (the row says yes until the server answers). */
    async queueMarkDone(email: string, org: string | null, obligationId: string): Promise<void> {
      const dup = (await this.pending(email)).find((t) => t.obligationId === obligationId)
      if (!dup) {
        const id = newId()
        await kv.set(outKey(email, id), { id, obligationId, queuedAt: now().toISOString(), attempts: 0 } satisfies QueuedTap)
      }
      const snap = await this.loadSnapshot(email, org)
      if (snap) {
        snap.page.rows = snap.page.rows.map((r) => (r.id === obligationId ? { ...r, yes: true } : r))
        await kv.set(snapKey(email, org), snap)
      }
    },
    async pending(email: string): Promise<QueuedTap[]> {
      const prefix = `${OUTBOX}${norm(email)}|`
      const out: QueuedTap[] = []
      for (const k of await kv.keys()) if (k.startsWith(prefix)) { const t = (await kv.get(k)) as QueuedTap | undefined; if (t) out.push(t) }
      return out.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    },
    /**
     * Send every waiting tap, oldest first. A tap the server accepts is removed. A network failure stops the run (keep the rest for later).
     * A refusal from the server (job already closed, no longer yours) drops that tap: retrying a "no" forever helps nobody. Returns counts.
     */
    async flush(email: string, send: (obligationId: string) => Promise<void>, isNetwork: (e: unknown) => boolean): Promise<{ sent: number; refused: number; left: number }> {
      let sent = 0, refused = 0
      const todo = await this.pending(email)
      for (let i = 0; i < todo.length; i++) {
        const t = todo[i]
        try {
          await send(t.obligationId)
          await kv.del(outKey(email, t.id))
          sent++
        } catch (e) {
          if (isNetwork(e)) return { sent, refused, left: todo.length - i }
          await kv.del(outKey(email, t.id))
          refused++
        }
      }
      return { sent, refused, left: 0 }
    },
    async setReminders(email: string, on: boolean): Promise<void> {
      if (on) await kv.set(remindKey(email), true)
      else { await kv.del(remindKey(email)); await kv.del(`remind:${norm(email)}|last`) }
    },
    /** The browser's own permission question is asked at most once per person per device; a "no" is never nagged again. */
    async reminderAsked(email: string): Promise<boolean> { return (await kv.get(`remind:${norm(email)}|asked`)) === true },
    async setReminderAsked(email: string): Promise<void> { await kv.set(`remind:${norm(email)}|asked`, true) },
    async remindersOn(email: string): Promise<boolean> { return (await kv.get(remindKey(email))) === true },
    /** A different person signed in on this device: remove everything that is not theirs. */
    async keepOnly(email: string): Promise<void> {
      const mine = `|`
      for (const k of await kv.keys()) {
        const who = k.slice(k.indexOf(":") + 1, k.indexOf(mine))
        if (who !== norm(email)) await kv.del(k)
      }
    },
    /** Sign-out: remove everything this device holds for anyone. */
    async wipe(): Promise<void> { await kv.clear() },
  }
}
