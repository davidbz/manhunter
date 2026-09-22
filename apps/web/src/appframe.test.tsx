import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_FRAME_COMMAND_TEST_ID,
  APP_FRAME_INTEL_TEST_ID,
  APP_FRAME_MAP_TEST_ID,
  APP_FRAME_RAIL_TEST_ID,
  AppFrame,
  SCREEN_FRAME_TEST_ID,
  ScreenFrame,
} from "./appframe";

/**
 * The frame (PLAN M6.2) is layout only, so what is asserted is that each slot lands in its own
 * region and the frame carries the label and test id it is handed. Whether the regions fit the
 * viewport is a real browser's question, not jsdom's, which does no layout.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME_TEST_ID = "some-screen";
const FRAME_LABEL = "Some screen";

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (node: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(node));
};

const find = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the app frame", () => {
  const renderFrame = () =>
    render(
      <AppFrame
        label={FRAME_LABEL}
        testId={FRAME_TEST_ID}
        rail={<span data-testid="rail-content" />}
        map={<span data-testid="map-content" />}
        intel={<span data-testid="intel-content" />}
        command={<span data-testid="command-content" />}
      />,
    );

  it("carries the label and test id it is handed", async () => {
    await renderFrame();

    expect(find(FRAME_TEST_ID)?.getAttribute("aria-label")).toBe(FRAME_LABEL);
  });

  it("puts each slot in its own region", async () => {
    await renderFrame();

    for (const [region, content] of [
      [APP_FRAME_RAIL_TEST_ID, "rail-content"],
      [APP_FRAME_MAP_TEST_ID, "map-content"],
      [APP_FRAME_INTEL_TEST_ID, "intel-content"],
      [APP_FRAME_COMMAND_TEST_ID, "command-content"],
    ] as const) {
      expect(find(region)?.contains(find(content))).toBe(true);
    }
  });

  it("names every region with the grid class index.css places it by", async () => {
    await renderFrame();

    expect(find(FRAME_TEST_ID)?.classList.contains("mh-frame")).toBe(true);
    expect(find(APP_FRAME_RAIL_TEST_ID)?.classList.contains("mh-frame__rail")).toBe(true);
    expect(find(APP_FRAME_MAP_TEST_ID)?.classList.contains("mh-frame__map")).toBe(true);
    expect(find(APP_FRAME_INTEL_TEST_ID)?.classList.contains("mh-frame__intel")).toBe(true);
    expect(find(APP_FRAME_COMMAND_TEST_ID)?.classList.contains("mh-frame__command")).toBe(true);
  });
});

describe("the screen frame", () => {
  it("holds its children in one scrolling column", async () => {
    await render(
      <ScreenFrame>
        <span data-testid="screen-content" />
      </ScreenFrame>,
    );

    expect(find(SCREEN_FRAME_TEST_ID)?.classList.contains("mh-screen")).toBe(true);
    expect(find(SCREEN_FRAME_TEST_ID)?.contains(find("screen-content"))).toBe(true);
  });
});
