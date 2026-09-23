import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { drawOf, mix32, streamBaseOf, textSeedOf } from "./seedhash";

const UINT32_MAX = 0xffff_ffff;
const arbitrarySeed = fc.integer({ min: 0, max: UINT32_MAX });

describe("the cosmetic seed hash", () => {
  test.prop([arbitrarySeed])("mixes to an unsigned 32-bit integer", (seed) => {
    const mixed = mix32(seed);

    expect(Number.isInteger(mixed)).toBe(true);
    expect(mixed).toBeGreaterThanOrEqual(0);
    expect(mixed).toBeLessThanOrEqual(UINT32_MAX);
  });

  test.prop([arbitrarySeed, fc.string(), fc.nat({ max: 64 })])(
    "draws the same value for the same seed, salt and index",
    (seed, salt, index) => {
      expect(drawOf(streamBaseOf(seed, salt), index)).toBe(drawOf(streamBaseOf(seed, salt), index));
    },
  );

  it("hashes text with FNV-1a", () => {
    expect(textSeedOf("")).toBe(0x811c_9dc5);
    expect(textSeedOf("a")).toBe(0xe40c_292c);
  });

  it("starts a different stream for a different salt", () => {
    expect(streamBaseOf(1, "avenue")).not.toBe(streamBaseOf(1, "street"));
  });
});
