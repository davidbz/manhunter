import { describe, expect, it } from "vitest";
import {
  contrastRatioOf,
  MIN_NON_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  relativeLuminanceOf,
} from "./contrast";
import { cssVariableNameOf } from "./cssvariables";
import STYLESHEET from "./index.css?raw";
import { PALETTE } from "./theme";

type ColorToken = keyof typeof PALETTE;

/** The four planes text is set on (DESIGN.md "Ground"): page, panels, cards, inset fields. */
const SURFACES = [
  "surfaceSunken",
  "background",
  "surfaceRaised",
  "surfaceOverlay",
] as const satisfies readonly ColorToken[];

/** Every token the stylesheet sets text in on those surfaces. */
const TEXT_INKS = [
  "text",
  "textMuted",
  "textDim",
  "accent",
  "exitGold",
] as const satisfies readonly ColorToken[];

/** The two places text is inverted: the commit button (and its hover) and `::selection`. */
const INVERTED_PAIRS = [
  { ink: "surfaceSunken", fill: "accent" },
  { ink: "surfaceSunken", fill: "text" },
] as const satisfies readonly { ink: ColorToken; fill: ColorToken }[];

/**
 * Non-text contrast (WCAG 1.4.11): the focus ring on every surface, and the form field's boundary
 * on the sunken field and the card it sits in. Disabled controls are exempt (WCAG 1.4.3's
 * "inactive user interface component"), which is why `FADE.disabled` is not audited here.
 */
const FOCUS_RING: ColorToken = "accent";
const FIELD_BOUNDARY: ColorToken = "textDim";
const FIELD_SURFACES = ["surfaceSunken", "surfaceOverlay"] as const satisfies readonly ColorToken[];

const TEXT_COLOR_DECLARATION = /(?<![\w-])color:\s*var\(--mh-color-([a-z-]+)\)/g;
const FIELD_RULE = /\.mh-form__field\s*\{([^}]*)\}/;
const BORDER_COLOR = /border:[^;]*var\(--mh-color-([a-z-]+)\)/;

const kebabTokenOf = (token: ColorToken): string =>
  cssVariableNameOf("color", token).replace("--mh-color-", "");

const ratioOf = (ink: ColorToken, surface: ColorToken): number =>
  contrastRatioOf(PALETTE[ink], PALETTE[surface]);

describe("the contrast arithmetic", () => {
  it("puts black and white at the two ends of the scale", () => {
    expect(relativeLuminanceOf("#000000")).toBe(0);
    expect(relativeLuminanceOf("#ffffff")).toBeCloseTo(1);
    expect(contrastRatioOf("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatioOf("#ffffff", "#000000")).toBeCloseTo(21);
  });

  it("gives a colour against itself a ratio of one", () => {
    expect(contrastRatioOf(PALETTE.accent, PALETTE.accent)).toBe(1);
  });

  it("matches a published reference pair: #767676 on white is the 4.5 threshold", () => {
    expect(contrastRatioOf("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("refuses a colour it cannot read as opaque hex rather than guessing", () => {
    expect(() => relativeLuminanceOf(PALETTE.shadowDeep)).toThrow();
    expect(() => relativeLuminanceOf("#fff")).toThrow();
  });
});

describe("the palette's contrast audit (PLAN M6.10)", () => {
  it.each(TEXT_INKS.flatMap((ink) => SURFACES.map((surface) => ({ ink, surface }))))(
    "sets $ink on $surface at the text threshold",
    ({ ink, surface }) => {
      expect(ratioOf(ink, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    },
  );

  it.each(INVERTED_PAIRS)("sets inverted $ink on $fill at the text threshold", ({ ink, fill }) => {
    expect(ratioOf(ink, fill)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it.each(SURFACES)("draws the focus ring on %s at the non-text threshold", (surface) => {
    expect(ratioOf(FOCUS_RING, surface)).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
  });

  it.each(FIELD_SURFACES)(
    "draws a form field's edge on %s at the non-text threshold",
    (surface) => {
      expect(ratioOf(FIELD_BOUNDARY, surface)).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
    },
  );
});

/**
 * The audit above is only as good as its lists. These tie the lists to the stylesheet, so a rule
 * that starts setting text in an unaudited token fails here instead of shipping unmeasured.
 */
describe("index.css against the audit", () => {
  it("sets text only in tokens the audit measures", () => {
    const audited = new Set(
      [...TEXT_INKS, ...INVERTED_PAIRS.map((pair) => pair.ink)].map(kebabTokenOf),
    );
    const used = [...STYLESHEET.matchAll(TEXT_COLOR_DECLARATION)].flatMap(([, token]) =>
      token === undefined ? [] : [token],
    );

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((token) => !audited.has(token))).toEqual([]);
  });

  it("draws the form field's edge in the audited boundary token", () => {
    const rule = FIELD_RULE.exec(STYLESHEET)?.[1] ?? "";

    expect(BORDER_COLOR.exec(rule)?.[1]).toBe(kebabTokenOf(FIELD_BOUNDARY));
  });

  it("does not fade a stale feed row below the audited colour", () => {
    const staleRow = /\.mh-feed__row\[data-staleness="stale"\]\s*\{([^}]*)\}/.exec(STYLESHEET);

    expect(staleRow?.[1]).toBeDefined();
    expect(staleRow?.[1]).not.toMatch(/opacity/);
  });
});
