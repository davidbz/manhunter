import { describe, expect, it } from "vitest";
import { GAME_TITLE } from "./meta";

describe("GAME_TITLE", () => {
  it("is a non-empty string every shell can render", () => {
    expect(GAME_TITLE.length).toBeGreaterThan(0);
    expect(GAME_TITLE.trim()).toBe(GAME_TITLE);
  });
});
