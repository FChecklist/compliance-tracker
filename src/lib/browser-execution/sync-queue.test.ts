import { describe, expect, test } from "bun:test";
import { SyncQueue } from "./sync-queue";

describe("SyncQueue", () => {
  test("enqueue then flushAll sends every entry and empties the queue on success", async () => {
    const sent: string[] = [];
    const queue = new SyncQueue<string>(async (payload) => {
      sent.push(payload);
      return true;
    });
    queue.enqueue("a", "payload-a");
    queue.enqueue("b", "payload-b");
    expect(queue.size()).toBe(2);

    const result = await queue.flushAll();
    expect(result).toEqual({ flushed: 2, remaining: 0 });
    expect(sent.sort()).toEqual(["payload-a", "payload-b"]);
    expect(queue.size()).toBe(0);
  });

  test("a failed send keeps the entry queued for the next flush", async () => {
    let shouldSucceed = false;
    const queue = new SyncQueue<string>(async () => shouldSucceed);
    queue.enqueue("a", "payload-a");

    const firstFlush = await queue.flushAll();
    expect(firstFlush).toEqual({ flushed: 0, remaining: 1 });
    expect(queue.size()).toBe(1);

    shouldSucceed = true;
    const secondFlush = await queue.flushAll();
    expect(secondFlush).toEqual({ flushed: 1, remaining: 0 });
  });

  test("a send that throws is treated the same as a failed send, not a crash", async () => {
    const queue = new SyncQueue<string>(async () => {
      throw new Error("network error");
    });
    queue.enqueue("a", "payload-a");
    const result = await queue.flushAll();
    expect(result).toEqual({ flushed: 0, remaining: 1 });
  });

  test("re-enqueueing the same id replaces the earlier entry rather than duplicating it", async () => {
    const sent: string[] = [];
    const queue = new SyncQueue<string>(async (payload) => {
      sent.push(payload);
      return true;
    });
    queue.enqueue("a", "first");
    queue.enqueue("a", "second");
    expect(queue.size()).toBe(1);
    await queue.flushAll();
    expect(sent).toEqual(["second"]);
  });
});
