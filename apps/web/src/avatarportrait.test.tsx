import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_RAMPS, AVATAR_TONE_COUNTS, avatarOf } from "./avatar";
import {
  AVATAR_LAYER_TEST_ID,
  AVATAR_TEST_ID,
  AvatarPortrait,
  DEFAULT_AVATAR_THEME,
  toneOf,
} from "./avatarportrait";

/**
 * The drawing half of PLAN M6.7. Asserted attribute by attribute against the avatar data, not
 * snapshotted (AGENTS.md "Do not snapshot-test SVG").
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE = 48;
const LABEL = "A witness";

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (node: ReactNode): Promise<HTMLElement> => {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  container = host;
  root = mounted;
  await act(async () => mounted.render(node));

  return host;
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the avatar theme", () => {
  it.each(AVATAR_RAMPS)("holds exactly as many %s tones as avatar.ts draws from", (ramp) => {
    expect(DEFAULT_AVATAR_THEME.ramps[ramp]).toHaveLength(AVATAR_TONE_COUNTS[ramp]);
  });
});

describe("toneOf", () => {
  it("reads the indexed tone", () => {
    expect(toneOf(["a", "b", "c"], 1)).toBe("b");
  });

  it("wraps an index past the end of the ramp", () => {
    expect(toneOf(["a", "b", "c"], 4)).toBe("b");
  });
});

describe("the avatar portrait", () => {
  const avatar = avatarOf(3, "witness");

  it("is one labelled image of the requested size", async () => {
    const host = await render(<AvatarPortrait avatar={avatar} label={LABEL} size={SIZE} />);
    const svg = host.querySelector(`[data-testid="${AVATAR_TEST_ID}"]`);

    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe(LABEL);
    expect(svg?.getAttribute("width")).toBe(String(SIZE));
    expect(svg?.getAttribute("height")).toBe(String(SIZE));
    expect(svg?.getAttribute("data-subject")).toBe("witness");
  });

  it("draws every layer, in order, filled from its ramp", async () => {
    const host = await render(<AvatarPortrait avatar={avatar} label={LABEL} size={SIZE} />);
    const paths = [...host.querySelectorAll(`[data-testid="${AVATAR_LAYER_TEST_ID}"]`)];

    expect(paths.map((path) => path.getAttribute("data-part"))).toEqual(
      avatar.layers.map((layer) => layer.part),
    );
    expect(paths.map((path) => path.getAttribute("d"))).toEqual(
      avatar.layers.map((layer) => layer.path),
    );
    expect(paths.map((path) => path.getAttribute("fill"))).toEqual(
      avatar.layers.map((layer) => toneOf(DEFAULT_AVATAR_THEME.ramps[layer.ramp], layer.tone)),
    );
  });
});
