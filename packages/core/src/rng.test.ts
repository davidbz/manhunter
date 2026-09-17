import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import type { NonEmptyArray, RngState, Weighted } from "./rng";
import { createRng } from "./rng";

const rng = createRng();

const uint32Sequence = (state: RngState, count: number): number[] => {
  const values: number[] = [];
  let current = state;
  for (let index = 0; index < count; index += 1) {
    const drawn = rng.uint32(current);
    current = drawn.state;
    values.push(drawn.value);
  }
  return values;
};

const intSequence = (
  state: RngState,
  count: number,
  minInclusive: number,
  maxExclusive: number,
): number[] => {
  const values: number[] = [];
  let current = state;
  for (let index = 0; index < count; index += 1) {
    const drawn = rng.int(current, minInclusive, maxExclusive);
    current = drawn.state;
    values.push(drawn.value);
  }
  return values;
};

const countBy = <T>(values: readonly T[]): Map<T, number> => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

const SEQUENCE_LENGTH = 8;
const SAMPLE_COUNT = 20_000;
const arbitrarySeed = fc.integer();

describe("Rng as logic", () => {
  // AGENTS.md section 1: logic holds no data of its own. The observable form of that rule for
  // the RNG is that a state is a complete description of the stream position.
  test.prop([arbitrarySeed])("draws depend only on the state passed in", (value) => {
    const state = rng.seed(value);
    expect(rng.uint32(state)).toEqual(rng.uint32(state));
    expect(rng.float(state)).toEqual(rng.float(state));
    expect(rng.shuffle(state, [1, 2, 3, 4, 5])).toEqual(rng.shuffle(state, [1, 2, 3, 4, 5]));
  });
});

describe("seed", () => {
  test.prop([arbitrarySeed])("the same seed produces the same sequence", (value) => {
    expect(uint32Sequence(rng.seed(value), SEQUENCE_LENGTH)).toEqual(
      uint32Sequence(rng.seed(value), SEQUENCE_LENGTH),
    );
  });

  test.prop([arbitrarySeed.chain((left) => fc.tuple(fc.constant(left), arbitrarySeed))])(
    "different seeds produce different sequences",
    ([left, right]) => {
      fc.pre(left !== right);
      expect(uint32Sequence(rng.seed(left), SEQUENCE_LENGTH)).not.toEqual(
        uint32Sequence(rng.seed(right), SEQUENCE_LENGTH),
      );
    },
  );

  // Every recorded replay is a seed plus an action list (DESIGN.md "After-action replay"), so a
  // change to the generator silently invalidates every replay ever shared. This pins the stream.
  it("produces a stable sequence for seed 1", () => {
    expect(uint32Sequence(rng.seed(1), 6)).toEqual([
      1130556604, 2591592147, 3014952990, 960850752, 2734082507, 3058966613,
    ]);
  });
});

describe("RngState", () => {
  test.prop([arbitrarySeed])("is four plain 32-bit integers", (value) => {
    const state = rng.seed(value);
    expect(Object.keys(state).toSorted()).toEqual(["a", "b", "c", "d"]);
    for (const word of Object.values(state)) {
      expect(Number.isSafeInteger(word)).toBe(true);
      expect(word).toBe(word | 0);
    }
  });

  // Architecture rule 3: state is plain serializable data. A replay that survives a JSON
  // round trip must resume the same stream, not merely deep-equal.
  test.prop([arbitrarySeed])("round-trips through JSON and resumes the same stream", (value) => {
    const state = rng.shuffle(rng.seed(value), [1, 2, 3, 4, 5]).state;
    const revived = JSON.parse(JSON.stringify(state)) as RngState;
    expect(revived).toEqual(state);
    expect(uint32Sequence(revived, SEQUENCE_LENGTH)).toEqual(
      uint32Sequence(state, SEQUENCE_LENGTH),
    );
  });
});

describe("fork", () => {
  // Fixed labels rather than generated ones: FNV-1a is 32-bit, so random string pairs can
  // collide and make a "different labels differ" property flaky. These are the labels the
  // simulation will actually use.
  const LABELS = ["map", "criminal", "reports", "events", "attempt-0", "attempt-1"] as const;

  test.prop([arbitrarySeed, fc.string()])(
    "is deterministic for a state and label",
    (value, label) => {
      const state = rng.seed(value);
      expect(rng.fork(state, label)).toEqual(rng.fork(state, label));
    },
  );

  test.prop([arbitrarySeed, fc.string()])("does not advance the parent", (value, label) => {
    const state = rng.seed(value);
    rng.fork(state, label);
    expect(uint32Sequence(state, SEQUENCE_LENGTH)).toEqual(
      uint32Sequence(rng.seed(value), SEQUENCE_LENGTH),
    );
  });

  test.prop([arbitrarySeed])("gives every label an independent stream", (value) => {
    const state = rng.seed(value);
    const sequences = LABELS.map((label) =>
      JSON.stringify(uint32Sequence(rng.fork(state, label), SEQUENCE_LENGTH)),
    );
    expect(new Set(sequences).size).toBe(LABELS.length);
    expect(sequences).not.toContain(JSON.stringify(uint32Sequence(state, SEQUENCE_LENGTH)));
  });

  test.prop([arbitrarySeed, fc.string()])(
    "separates streams forked from a moved parent",
    (value, label) => {
      const state = rng.seed(value);
      const moved = rng.uint32(state).state;
      expect(uint32Sequence(rng.fork(state, label), SEQUENCE_LENGTH)).not.toEqual(
        uint32Sequence(rng.fork(moved, label), SEQUENCE_LENGTH),
      );
    },
  );
});

describe("float", () => {
  test.prop([arbitrarySeed])("stays in [0, 1)", (value) => {
    let state = rng.seed(value);
    for (let index = 0; index < SEQUENCE_LENGTH; index += 1) {
      const drawn = rng.float(state);
      state = drawn.state;
      expect(drawn.value).toBeGreaterThanOrEqual(0);
      expect(drawn.value).toBeLessThan(1);
    }
  });
});

describe("int", () => {
  test.prop([
    arbitrarySeed,
    fc.integer({ min: -1000, max: 1000 }),
    fc.integer({ min: 1, max: 50 }),
  ])("stays in [minInclusive, maxExclusive)", (value, minInclusive, span) => {
    for (const drawn of intSequence(
      rng.seed(value),
      SEQUENCE_LENGTH,
      minInclusive,
      minInclusive + span,
    )) {
      expect(drawn).toBeGreaterThanOrEqual(minInclusive);
      expect(drawn).toBeLessThan(minInclusive + span);
      expect(Number.isInteger(drawn)).toBe(true);
    }
  });

  test.prop([arbitrarySeed, fc.integer({ min: -1000, max: 1000 })])(
    "draws nothing from an empty or inverted range",
    (value, minInclusive) => {
      const state = rng.seed(value);
      expect(rng.int(state, minInclusive, minInclusive)).toEqual({ state, value: minInclusive });
      expect(rng.int(state, minInclusive, minInclusive - 1)).toEqual({
        state,
        value: minInclusive,
      });
    },
  );

  it("reaches every value in the range at a roughly even rate", () => {
    const faces = 6;
    const counts = countBy(intSequence(rng.seed(7), SAMPLE_COUNT, 1, faces + 1));
    expect(counts.size).toBe(faces);
    const expected = SAMPLE_COUNT / faces;
    for (const [face, count] of counts) {
      expect(count, `face ${face}`).toBeGreaterThan(expected * 0.9);
      expect(count, `face ${face}`).toBeLessThan(expected * 1.1);
    }
  });
});

describe("pick", () => {
  const ITEMS: NonEmptyArray<string> = ["downtown", "park", "industrial", "transit_hub"];

  test.prop([arbitrarySeed])("returns a member of the list", (value) => {
    expect(ITEMS).toContain(rng.pick(rng.seed(value), ITEMS).value);
  });

  it("reaches every member", () => {
    let state = rng.seed(11);
    const seen = new Set<string>();
    for (let index = 0; index < ITEMS.length * 100; index += 1) {
      const drawn = rng.pick(state, ITEMS);
      state = drawn.state;
      seen.add(drawn.value);
    }
    expect(seen.size).toBe(ITEMS.length);
  });

  it("always returns the only member of a single-item list", () => {
    const single: NonEmptyArray<string> = ["exit"];
    expect(rng.pick(rng.seed(3), single).value).toBe("exit");
  });
});

describe("weightedPick", () => {
  const drawMany = (
    entries: NonEmptyArray<Weighted<string>>,
    count: number,
  ): Map<string, number> => {
    let state = rng.seed(23);
    const values: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const drawn = rng.weightedPick(state, entries);
      state = drawn.state;
      values.push(drawn.value);
    }
    return countBy(values);
  };

  it("never chooses a zero-weight candidate", () => {
    const counts = drawMany(
      [
        { value: "likely", weight: 3 },
        { value: "impossible", weight: 0 },
        { value: "rare", weight: 1 },
      ],
      SAMPLE_COUNT,
    );
    expect(counts.get("impossible")).toBeUndefined();
  });

  it("chooses in proportion to the weights", () => {
    const counts = drawMany(
      [
        { value: "heavy", weight: 7 },
        { value: "light", weight: 3 },
      ],
      SAMPLE_COUNT,
    );
    expect(counts.get("heavy") ?? 0).toBeGreaterThan(SAMPLE_COUNT * 0.67);
    expect(counts.get("heavy") ?? 0).toBeLessThan(SAMPLE_COUNT * 0.73);
  });

  it("treats a negative weight as zero", () => {
    const counts = drawMany(
      [
        { value: "normal", weight: 1 },
        { value: "negative", weight: -100 },
      ],
      1000,
    );
    expect(counts.get("negative")).toBeUndefined();
    expect(counts.get("normal")).toBe(1000);
  });

  it("falls back to a uniform draw when every weight is zero", () => {
    const counts = drawMany(
      [
        { value: "a", weight: 0 },
        { value: "b", weight: 0 },
      ],
      SAMPLE_COUNT,
    );
    expect(counts.size).toBe(2);
    expect(counts.get("a") ?? 0).toBeGreaterThan(SAMPLE_COUNT * 0.45);
  });

  test.prop([arbitrarySeed])("advances the state whatever the weights", (value) => {
    const state = rng.seed(value);
    const weighted: NonEmptyArray<Weighted<number>> = [
      { value: 1, weight: 1 },
      { value: 2, weight: 0 },
    ];
    const zeroed: NonEmptyArray<Weighted<number>> = [
      { value: 1, weight: 0 },
      { value: 2, weight: 0 },
    ];
    expect(rng.weightedPick(state, weighted).state).not.toEqual(state);
    expect(rng.weightedPick(state, zeroed).state).not.toEqual(state);
  });
});

describe("shuffle", () => {
  test.prop([arbitrarySeed, fc.array(fc.integer(), { maxLength: 30 })])(
    "returns a permutation of the input",
    (value, items) => {
      const shuffled = rng.shuffle(rng.seed(value), items).value;
      expect(shuffled.length).toBe(items.length);
      expect([...shuffled].toSorted()).toEqual([...items].toSorted());
    },
  );

  test.prop([arbitrarySeed, fc.array(fc.integer(), { maxLength: 30 })])(
    "leaves the input untouched",
    (value, items) => {
      const before = [...items];
      rng.shuffle(rng.seed(value), items);
      expect(items).toEqual(before);
    },
  );

  test.prop([arbitrarySeed])("draws nothing from an empty list", (value) => {
    const state = rng.seed(value);
    expect(rng.shuffle(state, [])).toEqual({ state, value: [] });
  });

  it("reaches every permutation", () => {
    let state = rng.seed(101);
    const seen = new Set<string>();
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const drawn = rng.shuffle(state, ["a", "b", "c"]);
      state = drawn.state;
      seen.add(drawn.value.join(""));
    }
    expect(seen.size).toBe(6);
  });
});
