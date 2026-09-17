import { describe, expect, it } from "vitest";
import type { GameConfig } from "./config";

const START_HOUR = 21;
const MAX_TURNS = 24;

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
};

describe("GameConfig", () => {
  it("round-trips through JSON, because a replay carries it (PLAN M3.9)", () => {
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });
});
