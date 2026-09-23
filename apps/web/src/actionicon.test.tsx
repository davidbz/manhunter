import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_ICON_TEST_ID, ActionIcon } from "./actionicon";
import { ACTION_KINDS } from "./actionpanel";
import { ACTION_ICON_THEME } from "./theme";

/** PLAN M6.8's stencil icons: one per MVP action, decorative, drawn in the tile's colour. */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

const renderAll = async (): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <div>
        {ACTION_KINDS.map((kind) => (
          <ActionIcon key={kind} kind={kind} />
        ))}
      </div>,
    );
  });
};

const icons = (): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${ACTION_ICON_TEST_ID}"]`) ?? []);

describe("the action icon", () => {
  it("has a glyph for every MVP action, and each glyph is distinct", () => {
    const glyphs = ACTION_KINDS.map((kind) => ACTION_ICON_THEME.glyphs[kind]);

    expect(glyphs.every((glyph) => glyph.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(ACTION_KINDS.length);
  });

  it("draws every action, named by kind", async () => {
    await renderAll();

    expect(icons().map((icon) => icon.getAttribute("data-icon"))).toEqual(ACTION_KINDS);
  });

  it("hides itself from assistive technology, since the tile already names the action", async () => {
    await renderAll();

    for (const icon of icons()) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
    }
  });

  it("strokes in currentColor, so the tile's state colours it", async () => {
    await renderAll();

    for (const icon of icons()) {
      expect(icon.querySelector("path")?.getAttribute("stroke")).toBe("currentColor");
    }
  });
});
