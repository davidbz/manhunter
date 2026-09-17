import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";

describe("LIMITS", () => {
  it("bounds every search with a positive whole number of steps", () => {
    for (const [name, bound] of Object.entries(LIMITS)) {
      expect(Number.isSafeInteger(bound), name).toBe(true);
      expect(bound, name).toBeGreaterThan(0);
    }
  });
});

describe("property harness", () => {
  // Architecture rule 3 makes JSON round-tripping the invariant every later core property
  // test rests on (M1.2, M3.8). Asserting it here proves the fast-check wiring before any
  // state exists to check it against.
  test.prop([fc.jsonValue()])("serializable data survives a JSON round trip", (value) => {
    const encoded = JSON.stringify(value);
    expect(JSON.stringify(JSON.parse(encoded))).toBe(encoded);
  });
});
