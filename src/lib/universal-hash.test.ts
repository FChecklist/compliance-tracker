import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { sha256Hex } from "./universal-hash";

function nodeSha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("sha256Hex", () => {
  test("matches Node's crypto.createHash('sha256') across sample inputs", () => {
    const samples = [
      "",
      "abc",
      "The quick brown fox jumps over the lazy dog",
      "a".repeat(1000),
      "unicode: café éè 中文 😀",
      "multi\nline\ntext\twith\ttabs",
      JSON.stringify({ a: 1, b: [1, 2, 3], c: "x".repeat(63) }),
    ];
    for (const s of samples) {
      expect(sha256Hex(s)).toBe(nodeSha256(s));
    }
  });

  test("returns a 64-char lowercase hex digest", () => {
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic and sensitive to every byte", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("hellp"));
  });

  test("handles inputs that land exactly on a 64-byte block boundary", () => {
    // 55 chars is the largest input that fits in one block with padding;
    // 56-64 chars force a second block -- exercise both edges.
    for (const len of [55, 56, 63, 64, 65, 119, 120, 128]) {
      const s = "x".repeat(len);
      expect(sha256Hex(s)).toBe(nodeSha256(s));
    }
  });
});
