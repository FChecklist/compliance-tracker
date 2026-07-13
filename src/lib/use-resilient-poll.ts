"use client";

import { useEffect, useRef } from "react";

// Polls `fn` starting immediately, then again after `baseMs` -- but only once
// the previous call has actually resolved (never overlaps a poll with one
// still in flight) and backs off exponentially, capped at `maxMs`, on
// consecutive failures. A single success resets the delay back to `baseMs`,
// so it recovers on its own the moment the backend comes back -- callers
// don't need their own retry/give-up logic.
//
// `fn` reports success via its boolean return (not by throwing): a fetch
// that resolves with a non-ok status or an unexpected shape should `return
// false`, not throw, since both outcomes are equally "the backend is down
// right now." Fixes the pre-existing AppShell/chat pollers that retried
// forever on a fixed cadence with no cap during a backend outage.
export function useResilientPoll(fn: () => Promise<boolean>, baseMs: number, maxMs = 120_000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = baseMs;

    async function run() {
      if (cancelled) return;
      const ok = await fnRef.current().catch(() => false);
      if (cancelled) return;
      delay = ok ? baseMs : Math.min(delay * 2, maxMs);
      timer = setTimeout(run, delay);
    }

    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseMs, maxMs]);
}
