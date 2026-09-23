/**
 * WCAG 2.x contrast arithmetic (PLAN M6.10), so the palette's legibility is a test rather than a
 * judgement. Written out rather than pulled from a package (AGENTS.md "Prefer writing 30 lines
 * over adding a package"): the formula is two lines of the WCAG definition of relative luminance.
 *
 * Logic only: it takes colours in and returns numbers out, and captures nothing.
 */

/** WCAG 1.4.3: body text against its background. */
export const MIN_TEXT_CONTRAST = 4.5;
/** WCAG 1.4.11: a focus indicator or a control's boundary against what it sits on. */
export const MIN_NON_TEXT_CONTRAST = 3;

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;

/** The piecewise sRGB transfer function's knee and constants, as the WCAG definition states them. */
const LINEAR_KNEE = 0.03928;
const LINEAR_SLOPE = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA = 2.4;

const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;

/** The flare term WCAG adds to both luminances so pure black does not divide by zero. */
const FLARE = 0.05;

const linearChannelOf = (hexPair: string): number => {
  const channel = Number.parseInt(hexPair, HEX_RADIX) / CHANNEL_MAX;
  if (channel <= LINEAR_KNEE) return channel / LINEAR_SLOPE;

  return ((channel + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
};

/** Relative luminance of an opaque `#rrggbb` colour; anything else is refused, never guessed at. */
export const relativeLuminanceOf = (hex: string): number => {
  const match = HEX_COLOR.exec(hex);
  if (match === null) throw new Error(`not an opaque #rrggbb colour: ${hex}`);
  const [, red = "", green = "", blue = ""] = match;

  return (
    RED_WEIGHT * linearChannelOf(red) +
    GREEN_WEIGHT * linearChannelOf(green) +
    BLUE_WEIGHT * linearChannelOf(blue)
  );
};

/** The contrast ratio of two opaque colours, from 1 (identical) to 21 (black on white). */
export const contrastRatioOf = (foreground: string, background: string): number => {
  const first = relativeLuminanceOf(foreground);
  const second = relativeLuminanceOf(background);

  return (Math.max(first, second) + FLARE) / (Math.min(first, second) + FLARE);
};
