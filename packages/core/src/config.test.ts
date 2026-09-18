import { describe, expect, it } from "vitest";
import type { GameConfig, GameSetup } from "./config";

// The setup/config split is a visibility rule, so it is checked in the type layer first: a
// `GameSetup` that grows either derived field fails `bun run typecheck` before any test runs.
type AssertTrue<T extends true> = T;
type KeyAbsent<T, Key extends string> = Key extends keyof T ? false : true;

export type SetupHidesTheProfile = AssertTrue<KeyAbsent<GameSetup, "criminalProfile">>;
export type SetupHidesTheStartHour = AssertTrue<KeyAbsent<GameSetup, "startHour">>;

const START_HOUR = 21;
const MAX_TURNS = 24;

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const setup: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

describe("GameConfig", () => {
  it("round-trips through JSON, because a world carries it", () => {
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });
});

describe("GameSetup", () => {
  it("round-trips through JSON, because a replay carries it (PLAN M3.9)", () => {
    expect(JSON.parse(JSON.stringify(setup))).toEqual(setup);
  });

  it("names neither of the two fields the seed derives instead", () => {
    for (const derived of ["criminalProfile", "startHour"]) {
      expect(Object.keys(setup)).not.toContain(derived);
    }
  });
});
