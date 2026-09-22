import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  AVATAR_KINDS,
  AVATAR_PARTS,
  AVATAR_TONE_COUNTS,
  type Avatar,
  avatarOf,
  REDACTED_AVATAR,
} from "./avatar";

/**
 * PLAN M6.7's first two ACs, on the data rather than the drawing: the same seed and kind always
 * give the same avatar, and different seeds give visibly different ones. "Visibly" is measured on
 * the layers - the paths and tones that reach the SVG - so two avatars differing only in a trait
 * nothing draws would not count.
 */

const arbitrarySeed = fc.integer({ min: 0, max: 0xffff_ffff });
const arbitraryKind = fc.constantFrom(...AVATAR_KINDS);

const SAMPLE_SEEDS = Array.from({ length: 64 }, (_, index) => index);

const looksOf = (avatar: Avatar): string => JSON.stringify(avatar.layers);

const partOrder = (avatar: Avatar): readonly number[] =>
  avatar.layers.map((layer) => AVATAR_PARTS.indexOf(layer.part));

describe("a seeded avatar", () => {
  test.prop([arbitrarySeed, arbitraryKind])("is the same avatar every time", (seed, kind) => {
    expect(avatarOf(seed, kind)).toEqual(avatarOf(seed, kind));
  });

  test.prop([arbitrarySeed, arbitraryKind])(
    "draws every tone from inside its ramp",
    (seed, kind) => {
      for (const layer of avatarOf(seed, kind).layers) {
        expect(layer.tone).toBeGreaterThanOrEqual(0);
        expect(layer.tone).toBeLessThan(AVATAR_TONE_COUNTS[layer.ramp]);
      }
    },
  );

  test.prop([arbitrarySeed, arbitraryKind])("layers back to front, once per part", (seed, kind) => {
    const order = partOrder(avatarOf(seed, kind));

    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(new Set(order).size).toBe(order.length);
  });

  test.prop([arbitrarySeed, arbitraryKind])("survives a JSON round trip", (seed, kind) => {
    const avatar = avatarOf(seed, kind);

    expect(JSON.parse(JSON.stringify(avatar))).toEqual(avatar);
  });

  it("differs between two neighbouring seeds", () => {
    expect(looksOf(avatarOf(1, "criminal"))).not.toBe(looksOf(avatarOf(2, "criminal")));
  });

  it.each(AVATAR_KINDS)("gives a %s most sampled seeds a face of their own", (kind) => {
    const looks = new Set(SAMPLE_SEEDS.map((seed) => looksOf(avatarOf(seed, kind))));

    expect(looks.size).toBeGreaterThan(SAMPLE_SEEDS.length / 2);
  });

  it("gives the same seed a different face for a different kind", () => {
    expect(looksOf(avatarOf(7, "witness"))).not.toBe(looksOf(avatarOf(7, "tip")));
  });
});

describe("the wardrobe", () => {
  test.prop([arbitrarySeed])("always masks the criminal, in the criminal's red", (seed) => {
    const mask = avatarOf(seed, "criminal").layers.find((layer) => layer.part === "mask");

    expect(mask?.ramp).toBe("mark");
  });

  test.prop([
    arbitrarySeed,
    fc.constantFrom(...AVATAR_KINDS.filter((kind) => kind !== "criminal")),
  ])("keeps the criminal's red off everyone else", (seed, kind) => {
    expect(avatarOf(seed, kind).layers.some((layer) => layer.ramp === "mark")).toBe(false);
  });

  test.prop([arbitrarySeed])("puts every patrol officer in the cap", (seed) => {
    expect(avatarOf(seed, "patrol").traits.headwear).toBe("cap");
  });
});

describe("the redacted avatar", () => {
  it("is drawn entirely from the redacted ramp", () => {
    expect(REDACTED_AVATAR.subject).toBe("redacted");
    expect(REDACTED_AVATAR.layers.length).toBeGreaterThan(0);
    expect(REDACTED_AVATAR.layers.every((layer) => layer.ramp === "redacted")).toBe(true);
  });

  it("stays inside the redacted ramp's tones", () => {
    for (const layer of REDACTED_AVATAR.layers) {
      expect(layer.tone).toBeLessThan(AVATAR_TONE_COUNTS.redacted);
    }
  });

  test.prop([arbitrarySeed])("is never what a seed draws for the criminal", (seed) => {
    expect(looksOf(avatarOf(seed, "criminal"))).not.toBe(looksOf(REDACTED_AVATAR));
  });
});
