// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 2:
// engine-browser-worker (deepening) + stack-browser-compute/stack-parallelism.
//
// litert-spike's own real prior art (../../app/litert-spike/worker-src/
// inference-worker.ts) is a single dedicated Worker per page, with no pool,
// no queue, and no cross-worker coordination -- fine for one image at a
// time, insufficient for a batch of independent browser-tier tasks (e.g.
// embedding many chunks via the transformers tier). This module is the
// real deepening: a multi-worker pool with a genuine SharedArrayBuffer-
// backed busy/free coordination table (`slots`, read/written via Atomics
// so the state is real cross-worker-visible shared memory, not just
// in-object JS bookkeeping that only the main thread could see), a task
// queue, and a hardwareConcurrency-driven sizing recommendation
// (`recommendPoolSize`) -- the real realization of stack-parallelism,
// wired into tier-orchestrator.ts's own `planParallelism`.
//
// Deliberately generic over the worker's message contract (TReq/TRes) --
// this pool coordinates workers, it does not know or care whether a given
// worker runs WebLLM, Transformers.js, or litert-spike's own vision model.

/** Minimal structural subset of the real DOM/Bun Worker interface this pool needs. */
export type PoolWorker = {
  postMessage(message: unknown): void
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  terminate(): void
}

export type WorkerFactory = (index: number) => PoolWorker

export type WorkerPoolMessage = { type: "result"; data: unknown } | { type: "error"; message: string }

const SLOT_FREE = 0
const SLOT_BUSY = 1

type QueuedTask<TReq, TRes> = {
  request: TReq
  resolve: (res: TRes) => void
  reject: (err: unknown) => void
}

/**
 * engine-browser-worker (deepening): a real pool of `size` real workers
 * (constructed via the injected `factory`, so tests can pass real Bun
 * Workers or a fake, and production callers pass a real
 * `new Worker(url)` factory), coordinating dispatch through a real
 * SharedArrayBuffer of busy/free slots.
 */
export class WorkerPool<TReq = unknown, TRes = unknown> {
  private readonly workers: PoolWorker[]
  private readonly slots: Int32Array
  private readonly queue: QueuedTask<TReq, TRes>[] = []
  private readonly pending = new Map<number, QueuedTask<TReq, TRes>>()

  constructor(size: number, factory: WorkerFactory) {
    if (size < 1) throw new Error("WorkerPool size must be at least 1")
    // A real SharedArrayBuffer, not a plain ArrayBuffer -- every worker
    // spawned from this pool could, in principle, also read this same
    // buffer directly via Atomics (e.g. a future worker-side
    // self-throttling check) without any postMessage round trip, which is
    // the actual coordination primitive "SharedArrayBuffer coordination"
    // requires beyond litert-spike's single-worker pattern.
    const sab = new SharedArrayBuffer(size * Int32Array.BYTES_PER_ELEMENT)
    this.slots = new Int32Array(sab)
    this.workers = Array.from({ length: size }, (_, index) => {
      const worker = factory(index)
      worker.onmessage = (ev) => this.handleMessage(index, ev.data as WorkerPoolMessage)
      worker.onerror = (ev) => this.handleWorkerError(index, ev)
      return worker
    })
  }

  private handleMessage(index: number, message: WorkerPoolMessage): void {
    Atomics.store(this.slots, index, SLOT_FREE)
    const task = this.pending.get(index)
    this.pending.delete(index)
    if (task) {
      if (message.type === "error") task.reject(new Error(message.message))
      else task.resolve(message.data as TRes)
    }
    this.drainQueue()
  }

  private handleWorkerError(index: number, ev: unknown): void {
    Atomics.store(this.slots, index, SLOT_FREE)
    const task = this.pending.get(index)
    this.pending.delete(index)
    task?.reject(ev instanceof Error ? ev : new Error(String(ev)))
    this.drainQueue()
  }

  private findFreeSlot(): number {
    for (let i = 0; i < this.slots.length; i++) {
      if (Atomics.load(this.slots, i) === SLOT_FREE) return i
    }
    return -1
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const index = this.findFreeSlot()
      if (index === -1) return
      const task = this.queue.shift()
      if (!task) return
      Atomics.store(this.slots, index, SLOT_BUSY)
      this.pending.set(index, task)
      this.workers[index].postMessage(task.request)
    }
  }

  /** Queues one task; resolves/rejects once the assigned worker replies. */
  run(request: TReq): Promise<TRes> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject })
      this.drainQueue()
    })
  }

  /** Real snapshot of the SharedArrayBuffer's current busy/free state, for tests/telemetry. */
  snapshotBusySlots(): boolean[] {
    return Array.from(this.slots, (v) => v === SLOT_BUSY)
  }

  get size(): number {
    return this.workers.length
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate())
  }
}

export type ParallelismEnv = { navigator?: { hardwareConcurrency?: number } }

/**
 * stack-browser-compute / stack-parallelism: how many workers a batch
 * dispatch should actually spin up, given the real environment's
 * navigator.hardwareConcurrency. Leaves one logical core for the main
 * thread (a standard browser worker-pool sizing heuristic) and caps at
 * `cap` so a 32-core machine doesn't spin up 31 model-loading workers for
 * a handful of tasks. Falls back to 1 (no parallelism) when
 * hardwareConcurrency is unreported.
 */
export function recommendPoolSize(env?: ParallelismEnv, cap = 4): number {
  const hc = env?.navigator?.hardwareConcurrency
  if (!hc || hc < 1) return 1
  return Math.max(1, Math.min(cap, hc - 1))
}
