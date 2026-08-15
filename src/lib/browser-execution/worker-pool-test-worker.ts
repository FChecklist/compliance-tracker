// Test-only real Worker, spawned by worker-pool.test.ts via a real
// `new Worker(new URL(...))` (Bun supports running TS worker files
// directly) -- so the pool's real postMessage/onmessage/Atomics
// coordination is exercised against a real separate JS execution context,
// not a same-thread stub. Doubles the given number after `delayMs`, so
// tests can control ordering deterministically without a sleep loop.
type InMsg = { n: number; delayMs: number }

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const { n, delayMs } = ev.data
  setTimeout(() => {
    postMessage({ type: "result", data: { doubled: n * 2 } })
  }, delayMs)
}
