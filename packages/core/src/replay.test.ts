import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import type { Difficulty, GameSetup } from "./config";
import type { HunterAction, HunterActionKind } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import {
  decodeReplay,
  encodeReplay,
  makeReplay,
  REPLAY_VERSION,
  type Replay,
  type ReplayDecoding,
  type ReplayEncoding,
  replayRefusalIn,
} from "./replay";

const SEED = 7;
const MAX_TURNS = 24;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

/** Keyed by kind, so a new `HunterAction` variant fails to compile until this file covers it. */
const ACTION_SAMPLES: Readonly<Record<HunterActionKind, HunterAction>> = {
  roadblock: { kind: "roadblock", edgeId: makeEdgeId("e-6-0-h") },
  canvass: { kind: "canvass", nodeId: makeNodeId("n-1-0") },
  pull_cctv: { kind: "pull_cctv", nodeId: makeNodeId("n-2-3") },
  true_briefing: { kind: "true_briefing" },
};

const EVERY_ACTION: readonly HunterAction[] = Object.values(ACTION_SAMPLES);

/** Same trick for the other closed set the grammar has to spell. */
const DIFFICULTY_SAMPLES: Readonly<Record<Difficulty, true>> = {
  easy: true,
  standard: true,
  hard: true,
};

const EVERY_DIFFICULTY = Object.keys(DIFFICULTY_SAMPLES) as readonly Difficulty[];

const replayOf = (actions: readonly (readonly HunterAction[])[], setup = SETUP): Replay =>
  makeReplay({ seed: SEED, setup, actions });

const stringFor = (replay: Replay): string => {
  const encoded = encodeReplay(replay);
  if (encoded.kind !== "replay_string") {
    throw new Error(`expected a string, got ${encoded.kind}`);
  }
  return encoded.value;
};

const replayFrom = (text: string): Replay => {
  const decoded = decodeReplay(text);
  if (decoded.kind !== "replay") {
    throw new Error(`expected a replay, got ${decoded.kind}`);
  }
  return decoded.replay;
};

/** A header whose seed is zero-padded to make the whole string exactly `length` characters. */
const paddedTo = (length: number): string => {
  const header = `${REPLAY_VERSION}.${SEED}.8.6.3.${MAX_TURNS}.s`;
  return header.replace(`.${SEED}.`, `.${"0".repeat(length - header.length)}${SEED}.`);
};

describe("makeReplay", () => {
  it("stamps the version this build reproduces", () => {
    expect(replayOf([]).version).toBe(REPLAY_VERSION);
  });

  it("keeps the seed, the setup and the actions as they were recorded", () => {
    const replay = replayOf([EVERY_ACTION, []]);

    expect(replay.seed).toBe(SEED);
    expect(replay.setup).toEqual(SETUP);
    expect(replay.actions).toEqual([EVERY_ACTION, []]);
  });
});

describe("the replay string", () => {
  it("round-trips a hunt with every action kind in it", () => {
    const replay = replayOf([EVERY_ACTION, [], [ACTION_SAMPLES.canvass]]);

    expect(replayFrom(stringFor(replay))).toEqual(replay);
  });

  it("round-trips a hunt with no turns in it", () => {
    expect(replayFrom(stringFor(replayOf([])))).toEqual(replayOf([]));
  });

  it("round-trips turns whose queue was empty", () => {
    const replay = replayOf([[], [], []]);

    expect(stringFor(replay)).toBe(`${REPLAY_VERSION}.${SEED}.8.6.3.${MAX_TURNS}.s~~~`);
    expect(replayFrom(stringFor(replay))).toEqual(replay);
  });

  it("round-trips every difficulty", () => {
    for (const difficulty of EVERY_DIFFICULTY) {
      const replay = replayOf([], { ...SETUP, difficulty });

      expect(replayFrom(stringFor(replay)).setup.difficulty).toBe(difficulty);
    }
  });

  it("gives each difficulty its own letter", () => {
    const letters = EVERY_DIFFICULTY.map((difficulty) =>
      stringFor(replayOf([], { ...SETUP, difficulty }))
        .split(".")
        .pop(),
    );

    expect(new Set(letters).size).toBe(EVERY_DIFFICULTY.length);
  });

  it("gives each action kind its own code", () => {
    const codes = EVERY_ACTION.map((action) => stringFor(replayOf([[action]])).slice(-1));

    expect(new Set(codes).size).toBe(EVERY_ACTION.length);
  });

  it("needs no URL escaping", () => {
    const value = stringFor(replayOf([EVERY_ACTION]));

    expect(encodeURIComponent(value)).toBe(value);
  });

  it("carries the seed, the setup and the actions, and nothing else", () => {
    expect(stringFor(replayOf([[ACTION_SAMPLES.canvass, ACTION_SAMPLES.true_briefing]]))).toBe(
      `${REPLAY_VERSION}.${SEED}.8.6.3.${MAX_TURNS}.s~cn-1-0_b`,
    );
  });
});

const arbitraryId = fc
  .tuple(fc.nat({ max: 15 }), fc.nat({ max: 15 }))
  .map(([column, row]) => `${column}-${row}`);

const arbitraryAction: fc.Arbitrary<HunterAction> = fc.oneof(
  fc.constant<HunterAction>({ kind: "true_briefing" }),
  arbitraryId.map((id): HunterAction => ({ kind: "canvass", nodeId: makeNodeId(`n-${id}`) })),
  arbitraryId.map((id): HunterAction => ({ kind: "pull_cctv", nodeId: makeNodeId(`n-${id}`) })),
  arbitraryId.map((id): HunterAction => ({ kind: "roadblock", edgeId: makeEdgeId(`e-${id}-h`) })),
);

const ARBITRARY_TURNS = 12;
const ARBITRARY_QUEUE = 3;
const ARBITRARY_GRID = 16;

const arbitraryReplay: fc.Arbitrary<Replay> = fc
  .record({
    seed: fc.nat(),
    setup: fc.record({
      map: fc.record({
        columns: fc.nat({ max: ARBITRARY_GRID }),
        rows: fc.nat({ max: ARBITRARY_GRID }),
        exitCount: fc.nat({ max: ARBITRARY_GRID }),
      }),
      /**
       * Never below the turns recorded under it: a recording longer than its own deadline is a
       * hunt that could not have happened and is refused (PLAN M4.2a), so a generated one would
       * be testing the refusal rather than the round trip.
       */
      maxTurns: fc.integer({ min: ARBITRARY_TURNS, max: LIMITS.maxGameTurns }),
      difficulty: fc.constantFrom(...EVERY_DIFFICULTY),
    }),
    actions: fc.array(fc.array(arbitraryAction, { maxLength: ARBITRARY_QUEUE }), {
      maxLength: ARBITRARY_TURNS,
    }),
  })
  .map((recorded) => makeReplay(recorded));

describe("encode then decode", () => {
  test.prop([arbitraryReplay])("gives back the replay that went in", (replay) => {
    expect(replayFrom(stringFor(replay))).toEqual(replay);
  });

  test.prop([arbitraryReplay])("gives back a string that needs no escaping", (replay) => {
    const value = stringFor(replay);

    expect(encodeURIComponent(value)).toBe(value);
  });
});

describe("decoding a string over the limit", () => {
  it("refuses one character over, before parsing it", () => {
    const text = paddedTo(LIMITS.maxReplayStringLength + 1);

    expect(text).toHaveLength(LIMITS.maxReplayStringLength + 1);
    expect(decodeReplay(text)).toEqual({
      kind: "too_long",
      length: LIMITS.maxReplayStringLength + 1,
      maxLength: LIMITS.maxReplayStringLength,
    });
  });

  it("accepts a string of exactly the limit", () => {
    const text = paddedTo(LIMITS.maxReplayStringLength);

    expect(text).toHaveLength(LIMITS.maxReplayStringLength);
    expect(replayFrom(text).seed).toBe(SEED);
  });

  it("refuses rather than truncates", () => {
    const decoded = decodeReplay(`${stringFor(replayOf([EVERY_ACTION]))}${"~b".repeat(4096)}`);

    expect(decoded.kind).toBe("too_long");
  });
});

describe("decoding a malformed string", () => {
  const cases: readonly { readonly name: string; readonly text: string; readonly field: string }[] =
    [
      { name: "an empty string", text: "", field: "version" },
      {
        name: "a header with too few fields",
        text: `${REPLAY_VERSION}.7.8.6.3.24`,
        field: "structure",
      },
      {
        name: "a header with too many fields",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s.x`,
        field: "structure",
      },
      { name: "a version that is not a number", text: "v.7.8.6.3.24.s", field: "version" },
      { name: "a negative version", text: "-1.7.8.6.3.24.s", field: "version" },
      {
        name: "a seed that is not a number",
        text: `${REPLAY_VERSION}.x.8.6.3.24.s`,
        field: "seed",
      },
      {
        name: "a seed in scientific notation",
        text: `${REPLAY_VERSION}.7e3.8.6.3.24.s`,
        field: "seed",
      },
      {
        name: "a seed with a decimal point",
        text: `${REPLAY_VERSION}.7.5.8.6.3.24.s`,
        field: "structure",
      },
      { name: "a signed seed", text: `${REPLAY_VERSION}.+7.8.6.3.24.s`, field: "seed" },
      {
        name: "a seed past the safe integers",
        text: `${REPLAY_VERSION}.99999999999999999999.8.6.3.24.s`,
        field: "seed",
      },
      {
        name: "columns that are not a number",
        text: `${REPLAY_VERSION}.7.wide.6.3.24.s`,
        field: "columns",
      },
      {
        name: "rows that are not a number",
        text: `${REPLAY_VERSION}.7.8.tall.3.24.s`,
        field: "rows",
      },
      {
        name: "an exit count that is not a number",
        text: `${REPLAY_VERSION}.7.8.6.many.24.s`,
        field: "exitCount",
      },
      {
        name: "a deadline that is not a number",
        text: `${REPLAY_VERSION}.7.8.6.3.soon.s`,
        field: "maxTurns",
      },
      {
        name: "a difficulty that has no letter",
        text: `${REPLAY_VERSION}.7.8.6.3.24.z`,
        field: "difficulty",
      },
      { name: "an empty difficulty", text: `${REPLAY_VERSION}.7.8.6.3.24.`, field: "difficulty" },
      {
        name: "an action code that means nothing",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s~zn-1-0`,
        field: "action",
      },
      { name: "an empty action", text: `${REPLAY_VERSION}.7.8.6.3.24.s~b__b`, field: "action" },
      {
        name: "a target with no code",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s~-1-0`,
        field: "action",
      },
      {
        name: "an action that lost its target",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s~c`,
        field: "action",
      },
      {
        name: "a global action given a target",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s~bn-1-0`,
        field: "action",
      },
      {
        name: "a target outside the alphabet",
        text: `${REPLAY_VERSION}.7.8.6.3.24.s~cn 1`,
        field: "action",
      },
    ];

  for (const { name, text, field } of cases) {
    it(`names the field that was wrong in ${name}`, () => {
      expect(decodeReplay(text)).toEqual({ kind: "malformed", field });
    });
  }

  it("reads a number the grammar cannot have written", () => {
    expect(replayFrom(`${REPLAY_VERSION}.007.8.6.3.24.s`).seed).toBe(SEED);
  });
});

describe("a replay from another version", () => {
  const NEXT_VERSION = REPLAY_VERSION + 1;
  /** A whole hunt in version 1's grammar: the header, then a turn the hunter sat out. */
  const VERSION_ONE_LINK = "1.7.8.6.3.24.s~";
  /** Version 2's grammar: a hunt that put a checkpoint on an edge, then waited beside it. */
  const VERSION_TWO_LINK = "2.7.8.6.3.24.s~re-1-0-h~";
  /** The same hunt in version 3's grammar, which is unchanged; only what it plays out to moved. */
  const VERSION_THREE_LINK = "3.7.8.6.3.24.s~re-1-0-h~";

  it("is refused rather than played", () => {
    expect(decodeReplay(`${NEXT_VERSION}.7.8.6.3.24.s`)).toEqual({
      kind: "unsupported_version",
      version: NEXT_VERSION,
      supported: REPLAY_VERSION,
    });
  });

  it("is detected before the rest of the grammar is", () => {
    expect(decodeReplay(`${NEXT_VERSION}.whatever.the.next.grammar.is`)).toEqual({
      kind: "unsupported_version",
      version: NEXT_VERSION,
      supported: REPLAY_VERSION,
    });
  });

  /**
   * A share link the previous build really could produce, written out rather than derived, which
   * is the only thing that can hold the bump honest: PLAN M4.3 moved `slipPastChance`, so the
   * checkpoint this recording's criminal walks into resolves the other way and playing it now
   * hands back a hunt its author never saw.
   */
  it("refuses a link recorded by the build before this one", () => {
    expect(decodeReplay(VERSION_THREE_LINK)).toEqual({
      kind: "unsupported_version",
      version: 3,
      supported: REPLAY_VERSION,
    });
  });

  /**
   * And every build before that, so a bump that is reverted rather than raised is caught by more
   * than the one link above.
   */
  it("refuses a link recorded by the build before that one", () => {
    expect(decodeReplay(VERSION_TWO_LINK)).toEqual({
      kind: "unsupported_version",
      version: 2,
      supported: REPLAY_VERSION,
    });
  });

  it("refuses a link from the build before that, so a reverted bump is caught more than twice", () => {
    expect(decodeReplay(VERSION_ONE_LINK)).toEqual({
      kind: "unsupported_version",
      version: 1,
      supported: REPLAY_VERSION,
    });
  });

  it("is refused by the encoder too", () => {
    const foreign: Replay = { ...replayOf([]), version: REPLAY_VERSION + 1 };

    expect(encodeReplay(foreign)).toEqual({
      kind: "unsupported_version",
      version: REPLAY_VERSION + 1,
      supported: REPLAY_VERSION,
    });
  });
});

const OVER_THE_QUEUE = LIMITS.maxQueuedActions + 1;
const OVER_THE_DEADLINE = LIMITS.maxGameTurns + 1;
/**
 * A recording longer than the hunt it claims to be. The deadline end condition (PLAN M4.2a) stops
 * a hunt on its own `setup.maxTurns`, so anything past that is a hunt that could not have happened
 * - and the setup's number is always the tighter of the two, because a deadline over
 * `maxGameTurns` has already been refused by the case above.
 */
const OVER_THE_SETUP = MAX_TURNS + 1;

const overlongQueue = (): readonly HunterAction[] =>
  Array.from({ length: OVER_THE_QUEUE }, () => ACTION_SAMPLES.true_briefing);

/**
 * The counts, checked against the replay so that both directions refuse the same set: a string
 * `encode` produced that `decode` then refused would be a share link that dies on arrival.
 */
describe("the counts a replay may name", () => {
  const cases: readonly {
    readonly name: string;
    readonly replay: Replay;
    readonly text: string;
    readonly refusal: ReplayDecoding & ReplayEncoding;
  }[] = [
    {
      name: "a deadline past the cap",
      replay: replayOf([], { ...SETUP, maxTurns: OVER_THE_DEADLINE }),
      text: `${REPLAY_VERSION}.7.8.6.3.${OVER_THE_DEADLINE}.s`,
      refusal: {
        kind: "deadline_too_long",
        requestedTurns: OVER_THE_DEADLINE,
        maxTurns: LIMITS.maxGameTurns,
      },
    },
    {
      name: "more turns than its own setup allows",
      replay: replayOf(Array.from({ length: OVER_THE_SETUP }, () => [])),
      text: `${REPLAY_VERSION}.7.8.6.3.${MAX_TURNS}.s${"~".repeat(OVER_THE_SETUP)}`,
      refusal: {
        kind: "too_many_turns",
        recordedTurns: OVER_THE_SETUP,
        maxTurns: MAX_TURNS,
      },
    },
    {
      name: "a queue longer than one turn may hold",
      replay: replayOf([[], overlongQueue()]),
      text: `${REPLAY_VERSION}.7.8.6.3.${MAX_TURNS}.s~~${Array.from({ length: OVER_THE_QUEUE }, () => "b").join("_")}`,
      refusal: {
        kind: "too_many_actions",
        turn: 1,
        requestedActions: OVER_THE_QUEUE,
        maxActions: LIMITS.maxQueuedActions,
      },
    },
  ];

  for (const { name, replay, text, refusal } of cases) {
    it(`refuses ${name} on the way in`, () => {
      expect(decodeReplay(text)).toEqual(refusal);
    });

    it(`refuses ${name} on the way out`, () => {
      expect(encodeReplay(replay)).toEqual(refusal);
    });

    it(`says so before anything else does, for ${name}`, () => {
      expect(replayRefusalIn(replay)).toEqual(refusal);
    });
  }

  it("accepts a queue of exactly the cap", () => {
    const full = Array.from(
      { length: LIMITS.maxQueuedActions },
      () => ACTION_SAMPLES.true_briefing,
    );

    expect(replayRefusalIn(replayOf([full]))).toBeNull();
  });

  it("accepts as many turns as its own setup allows", () => {
    const hunt = Array.from({ length: MAX_TURNS }, () => []);

    expect(replayRefusalIn(replayOf(hunt))).toBeNull();
  });

  it("accepts a hunt as long as the cap when the setup asks for one", () => {
    const hunt = Array.from({ length: LIMITS.maxGameTurns }, () => []);

    expect(replayRefusalIn(replayOf(hunt, { ...SETUP, maxTurns: LIMITS.maxGameTurns }))).toBeNull();
  });

  /** A hunt that never took a turn is a recording of nothing, not a malformed one. */
  it("accepts a recording of no turns at all against a deadline of none", () => {
    expect(replayRefusalIn(replayOf([], { ...SETUP, maxTurns: 0 }))).toBeNull();
    expect(replayRefusalIn(replayOf([[]], { ...SETUP, maxTurns: 0 }))).toMatchObject({
      kind: "too_many_turns",
      maxTurns: 0,
    });
  });
});

describe("encoding a replay the grammar cannot spell", () => {
  const cases: readonly {
    readonly name: string;
    readonly replay: Replay;
    readonly field: string;
  }[] = [
    {
      name: "a negative seed",
      replay: makeReplay({ seed: -1, setup: SETUP, actions: [] }),
      field: "seed",
    },
    {
      name: "a fractional seed",
      replay: makeReplay({ seed: 1.5, setup: SETUP, actions: [] }),
      field: "seed",
    },
    {
      name: "a seed past the safe integers",
      replay: makeReplay({ seed: Number.MAX_SAFE_INTEGER + 2, setup: SETUP, actions: [] }),
      field: "seed",
    },
    {
      name: "a negative grid",
      replay: replayOf([], { ...SETUP, map: { ...SETUP.map, columns: -8 } }),
      field: "columns",
    },
    {
      name: "a fractional row count",
      replay: replayOf([], { ...SETUP, map: { ...SETUP.map, rows: 6.5 } }),
      field: "rows",
    },
    {
      name: "a negative exit count",
      replay: replayOf([], { ...SETUP, map: { ...SETUP.map, exitCount: -1 } }),
      field: "exitCount",
    },
    {
      name: "a fractional deadline",
      replay: replayOf([], { ...SETUP, maxTurns: 1.5 }),
      field: "maxTurns",
    },
    {
      name: "an id carrying a separator",
      replay: replayOf([[{ kind: "canvass", nodeId: makeNodeId("n~1") }]]),
      field: "action",
    },
    {
      name: "an empty id",
      replay: replayOf([[{ kind: "roadblock", edgeId: makeEdgeId("") }]]),
      field: "action",
    },
  ];

  for (const { name, replay, field } of cases) {
    it(`refuses ${name} rather than writing a string that cannot be read back`, () => {
      expect(encodeReplay(replay)).toEqual({ kind: "not_encodable", field });
    });
  }
});

describe("encoding a replay too long to share", () => {
  it("refuses it with the length it would have been", () => {
    const queue = Array.from({ length: LIMITS.maxQueuedActions }, () => ACTION_SAMPLES.roadblock);
    const encoded = encodeReplay(
      replayOf(
        Array.from({ length: LIMITS.maxGameTurns }, () => queue),
        {
          ...SETUP,
          maxTurns: LIMITS.maxGameTurns,
        },
      ),
    );

    expect(encoded.kind).toBe("too_long");
    expect(encoded).toMatchObject({ maxLength: LIMITS.maxReplayStringLength });
  });

  it("writes the longest hunt that can actually be played", () => {
    const affordable = Array.from({ length: 3 }, () => ACTION_SAMPLES.roadblock);
    const value = stringFor(
      replayOf(
        Array.from({ length: LIMITS.maxGameTurns }, () => affordable),
        { ...SETUP, map: { columns: 16, rows: 16, exitCount: 3 }, maxTurns: LIMITS.maxGameTurns },
      ),
    );

    expect(value.length).toBeLessThanOrEqual(LIMITS.maxReplayStringLength);
  });
});
