import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";

describe("LIMITS", () => {
  it("bounds every web boundary with a positive whole number", () => {
    for (const [name, bound] of Object.entries(LIMITS)) {
      expect(Number.isSafeInteger(bound), name).toBe(true);
      expect(bound, name).toBeGreaterThan(0);
    }
  });
});
