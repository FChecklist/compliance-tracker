// PROJEXA-BUILD-002 WP-13 (AW-605): a deterministic local stand-in for a connected mailbox or Drive folder, for tests only. It is the
// "fake folder" the way-5 flow is proven with when no Drive or mailbox is connected: a list of entries the test adds to, a clock the
// test sets (no entry has a time of its own), and counters that say how often the scan listed and downloaded. Nothing in it reads a
// disk or a network, and it is not shipped: no production file imports it.
import { FolderSourceError, type FolderFile, type FolderSource } from "../folder-watch-service"

export type FakeEntry = {
  id: string
  name: string
  bytes: Uint8Array
  modifiedAt: Date
  sender?: string | null
  mimeType?: string | null
  /** What the listing says the size is; defaults to the real byte length. A test sets it to lie about a file. */
  sizeBytes?: number | null
}

export type FakeFolderOptions = {
  kind?: FolderSource["kind"]
  /** List every entry whatever `after` says, in the reverse of time order: the scan must not trust the source to sort or filter. */
  untrusted?: boolean
}

export function fakeFolder(initial: FakeEntry[] = [], options: FakeFolderOptions = {}) {
  const entries: FakeEntry[] = [...initial]
  const calls = { list: 0, download: 0, downloaded: [] as string[] }
  /** Ids whose next download throws (once each): a source that could not hand the file over. */
  const failDownload = new Set<string>()
  let listFails: string | null = null
  const source: FolderSource = {
    kind: options.kind ?? "test",
    async list({ after, limit }) {
      calls.list++
      if (listFails) throw new FolderSourceError(listFails, "the source could not be listed")
      const visible = options.untrusted ? [...entries].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()) : entries.filter((e) => !after || e.modifiedAt.getTime() >= after.getTime())
      return visible.slice(0, options.untrusted ? visible.length : limit).map(
        (e): FolderFile => ({ id: e.id, name: e.name, mimeType: e.mimeType ?? null, sizeBytes: e.sizeBytes === undefined ? e.bytes.byteLength : e.sizeBytes, modifiedAt: e.modifiedAt, sender: e.sender ?? null }),
      )
    },
    async download(file) {
      calls.download++
      calls.downloaded.push(file.id)
      if (failDownload.delete(file.id)) throw new FolderSourceError("source_read_failed", "the download failed")
      const entry = entries.find((e) => e.id === file.id)
      if (!entry) throw new FolderSourceError("bad_file", "no such file")
      return entry.bytes
    },
  }
  return {
    source,
    calls,
    add: (entry: FakeEntry) => void entries.push(entry),
    failNextDownload: (id: string) => void failDownload.add(id),
    failList: (code: string | null) => void (listFails = code),
  }
}
