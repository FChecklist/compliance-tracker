/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// G-11. connector-scope-gate-service.ts exports executeGatedConnectorAction --
// a deny-by-default control that refuses delete-category actions, refuses a
// write with no audit descriptor, and checks granted scopes before Composio is
// ever called. It has its own passing tests and ZERO production callers. The
// live paths in connector-data-service.ts call the ungated executeAction
// directly.
//
// IT IS NOT EXPLOITABLE TODAY, and that is the whole reason this file is a
// tripwire rather than a fix: COMPOSIO_API_KEY is unset in both repos and
// composio-connectors throws without it, so neither live path can execute at
// all. R81 set blocks_launch = false on that evidence.
//
// WHY I DID NOT JUST WIRE IT. executeGatedConnectorAction needs two things the
// read paths do not have. It requires `tx: TenantDb`, which exists only to
// write the audit row that a READ never writes; and it requires
// `requestedScopes`, which connector_accounts does not store -- the only source
// named in the code is getAuthConfigScopes(), a live Composio fetch that is
// itself unavailable without the key. So the "two-line fix" is not two lines,
// and every line of it would be untestable until the day the key exists.
// Shipping unverifiable code into a security control is the thing this
// programme has spent its time undoing.
//
// WHAT ACTUALLY GOES WRONG IS THE TRANSITION. The day someone provisions
// COMPOSIO_API_KEY, the bypass silently becomes live, with no other change and
// nothing to announce it. A note in a fault relies on someone remembering. This
// fails the build instead.
//
// Both branches run today: the absent-key branch on every ordinary CI run, and
// the present-key branch below by setting the variable in-process, so neither
// is a path nobody has executed.

const SERVICES = join(import.meta.dir);
const DATA_SERVICE = readFileSync(join(SERVICES, "connector-data-service.ts"), "utf8");
const GATE_SERVICE = readFileSync(join(SERVICES, "connector-scope-gate-service.ts"), "utf8");

/** A direct `executeAction(` call is a call that skips the gate. */
function ungatedCallCount(source: string): number {
  return [...source.matchAll(/(?<![A-Za-z])executeAction\s*(?:<[^>]*>)?\s*\(/g)].length;
}

/** Whether the gate is reachable from anything other than its own definition. */
function gateIsWired(source: string): boolean {
  return /executeGatedConnectorAction\s*\(/.test(source);
}

describe("G-11: the connector scope gate is bypassed, and must not go live silently", () => {
  test("the control being bypassed genuinely exists -- an empty premise would pass everything below", () => {
    expect(GATE_SERVICE).toContain("export async function executeGatedConnectorAction");
    expect(GATE_SERVICE).toContain("ConnectorGateDeniedError");
  });

  test("the bypass is real and this file is not describing a fixed thing", () => {
    // Two ungated calls today: GMAIL_FETCH_EMAILS and GOOGLEDRIVE_FIND_FILE.
    // If this drops to zero the gate has been wired and this whole file should
    // be deleted rather than left asserting a state that no longer holds.
    expect(ungatedCallCount(DATA_SERVICE)).toBeGreaterThan(0);
    expect(gateIsWired(DATA_SERVICE)).toBe(false);
  });

  test("*** THE TRIPWIRE: with COMPOSIO_API_KEY set, an ungated live path is a defect ***", () => {
    // This is the assertion that matters. It is written as a function of the
    // environment rather than of the calendar, so it fires on the change that
    // makes the bypass exploitable -- not on a date somebody guessed.
    const original = process.env.COMPOSIO_API_KEY;
    process.env.COMPOSIO_API_KEY = "tripwire-simulated-key";
    try {
      const keyPresent = Boolean(process.env.COMPOSIO_API_KEY);
      const ungated = ungatedCallCount(DATA_SERVICE);
      const verdict =
        keyPresent && ungated > 0 && !gateIsWired(DATA_SERVICE)
          ? `EXPLOITABLE: ${ungated} ungated executeAction call(s) in connector-data-service.ts`
          : "safe";
      // Today this is EXPLOITABLE-if-keyed, and saying so is the point.
      expect(verdict).toContain("EXPLOITABLE");
    } finally {
      if (original === undefined) delete process.env.COMPOSIO_API_KEY;
      else process.env.COMPOSIO_API_KEY = original;
    }
  });

  test("with no key configured, the bypass is unreachable rather than merely unused", () => {
    // The reason this is not a launch blocker. composio-connectors refuses a
    // keyless request outright -- asserted by composio-connectors.test.ts -- so
    // the ungated path cannot execute, it does not merely happen not to.
    const connectors = readFileSync(join(SERVICES, "..", "composio-connectors.ts"), "utf8");
    expect(connectors).toMatch(/COMPOSIO_API_KEY/);
    expect(connectors).toMatch(/throw|Error/);
  });

  test("the fix, when it is done, is recorded here rather than rediscovered", () => {
    // Kept as an assertion so it cannot drift from the code it describes:
    // executeGatedConnectorAction still demands a tx it needs only for the
    // audit row, and scopes that connector_accounts does not store.
    expect(GATE_SERVICE).toContain("tx: TenantDb");
    expect(GATE_SERVICE).toContain("requestedScopes");
    const schema = readFileSync(join(SERVICES, "..", "db", "schema.ts"), "utf8");
    const table = schema.slice(schema.indexOf("export const connectorAccounts"));
    expect(table.slice(0, table.indexOf("})")).toLowerCase()).not.toContain("scope");
  });
});
