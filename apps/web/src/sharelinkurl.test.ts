import { encodeReplay, type GameSetup, makeReplay } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import { decodeShareLink, replayParamOf, SHARE_LINK_PARAM, shareLinkFor } from "./sharelinkurl";

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 7;

const REPLAY = makeReplay({ seed: SEED, setup: SETUP, actions: [] });

const stringFor = (): string => {
  const encoded = encodeReplay(REPLAY);
  if (encoded.kind !== "replay_string") {
    throw new Error(`expected a string, got ${encoded.kind}`);
  }
  return encoded.value;
};

describe("replayParamOf", () => {
  it("reads the replay parameter out of a search string", () => {
    const value = stringFor();

    expect(replayParamOf(`?${SHARE_LINK_PARAM}=${encodeURIComponent(value)}`)).toBe(value);
  });

  it("is null when the page carries no share link", () => {
    expect(replayParamOf("")).toBeNull();
    expect(replayParamOf("?other=1")).toBeNull();
  });
});

describe("decodeShareLink", () => {
  it("decodes a well-formed replay string", () => {
    expect(decodeShareLink(stringFor())).toEqual({ kind: "replay", replay: REPLAY });
  });

  it("refuses a malformed string, forwarded from decodeReplay", () => {
    expect(decodeShareLink("not a replay")).toMatchObject({ kind: "malformed" });
  });

  it("accepts a string of exactly the bound and lets decodeReplay read it", () => {
    const value = stringFor();
    const padded = `${value}${"0".repeat(LIMITS.maxReplayStringLength - value.length)}`;

    expect(padded).toHaveLength(LIMITS.maxReplayStringLength);
    expect(decodeShareLink(padded).kind).not.toBe("share_link_too_long");
  });

  /**
   * The task's own AC: a URL one character over the bound is rejected with an error, not
   * truncated or parsed. Padding a genuinely valid replay string out to one over the limit and
   * asserting the refusal reports the *untruncated* length is what tells "refused" apart from
   * "silently shortened to the bound and then parsed" - a truncation would either still decode
   * (this is a valid replay's own bytes, unmodified, with harmless digits after) or report a
   * length of exactly the bound rather than one more than it.
   */
  it("refuses a string one character over the bound, and does not truncate it first", () => {
    const value = stringFor();
    const overLong = `${value}${"0".repeat(LIMITS.maxReplayStringLength - value.length + 1)}`;

    expect(overLong).toHaveLength(LIMITS.maxReplayStringLength + 1);
    expect(decodeShareLink(overLong)).toEqual({
      kind: "share_link_too_long",
      length: LIMITS.maxReplayStringLength + 1,
      maxLength: LIMITS.maxReplayStringLength,
    });
  });
});

describe("shareLinkFor", () => {
  it("writes the replay into the replay parameter, clearing any stale query or hash", () => {
    const encoding = shareLinkFor(REPLAY, "https://example.test/game?stale=1#stale-hash");
    if (encoding.kind !== "share_link") {
      throw new Error(`expected a link, got ${encoding.kind}`);
    }

    const url = new URL(encoding.url);
    expect(url.origin + url.pathname).toBe("https://example.test/game");
    expect(url.hash).toBe("");
    expect(url.searchParams.get(SHARE_LINK_PARAM)).toBe(stringFor());
    expect(url.searchParams.has("stale")).toBe(false);
    expect(Array.from(url.searchParams.keys())).toEqual([SHARE_LINK_PARAM]);
  });

  it("round-trips through decodeShareLink", () => {
    const encoding = shareLinkFor(REPLAY, "https://example.test/");
    if (encoding.kind !== "share_link") {
      throw new Error(`expected a link, got ${encoding.kind}`);
    }

    const url = new URL(encoding.url);
    const value = replayParamOf(url.search);
    if (value === null) {
      throw new Error("expected the built link to carry a replay parameter");
    }

    expect(decodeShareLink(value)).toEqual({ kind: "replay", replay: REPLAY });
  });
});
