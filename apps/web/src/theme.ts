/**
 * `apps/web`'s design system (PLAN M6.1, growing M5.7's token file): the one place every colour,
 * type step, spacing step, stroke weight, shadow and motion duration the UI draws with is named,
 * and the one place DESIGN.md's "Visual direction" - Payday dispatch board crossed with a Door
 * Kickers tactical plan - is stated as values.
 *
 * **Data only.** Every export below is a plain frozen object literal. The derivation that turns
 * them into CSS custom properties is logic and lives in `cssvariables.ts`; the composition root
 * applies them (AGENTS.md "Inversion of control"). Nothing here imports logic or holds behaviour.
 *
 * **Colour literals live here and nowhere else** under `apps/web` - `tools/theme/colorliterals.ts`
 * scans the rest of the tree, `index.css` included, and fails if one leaks out. `index.css` is
 * therefore written entirely in `var(--mh-*)` references, whose values come from `DESIGN_TOKENS`.
 *
 * `packages/sim/src/svg.ts` carries a separate palette, `DEFAULT_SVG_THEME`, for its standalone map
 * debug export, and it cannot import this file: architecture rule 5 lets `apps/web` depend on
 * `packages/core` only (never the other way, and never on `packages/sim`), and there is no third
 * location either side could move a palette to - `core` holds no presentation strings
 * (architecture rule 1). Left alone deliberately; see the Inbox entry in `docs/PLAN.md`.
 */

import type { DistrictType, EdgeKind } from "@manhunter/core";
import type { HeatRamp } from "./beliefoverlay";
import type { CriminalPathTheme } from "./criminalpath";
import type { MapEdgeStyle, MapTheme } from "./maprenderer";

/**
 * Raw colour tokens.
 *
 * Three groups, in DESIGN.md's order. **Surfaces** are the near-black elevation ramp the whole
 * board sits on; a panel is a raised plane with a hairline edge, not a box with a border, so the
 * ramp carries the depth and `edgeHairline` carries the separation. **Hue discipline** is the
 * rule that keeps the map readable: red is the criminal, gold is objectives and money, cyan is the
 * player's own instruments, and nothing else is saturated. **Map tones** are the desaturated
 * district and edge-kind fills, which are allowed hues because the map is the one surface that
 * earns them - and every edge kind still differs by dash and width as well, so hue is never the
 * only channel carrying the distinction.
 */
export const PALETTE = {
  surfaceSunken: "#06080b",
  background: "#0b0f14",
  surfaceRaised: "#131a23",
  surfaceOverlay: "#1b2530",
  edgeHairline: "#2a3846",
  edgeStrong: "#3d5064",

  text: "#e8f1ff",
  textMuted: "#93a5ba",
  textDim: "#5e7288",

  /** The criminal: heat, located incidents, a checkpoint that fired. */
  incidentRed: "#e8483f",
  /** Objectives and money: exits, budget, the score tally. */
  exitGold: "#f2b134",
  /**
   * The player's own instruments: selection, keyboard focus, the armed tool. Pinned to this exact
   * value by `meters.test.tsx`, which asserts the computed `accentColor` is `rgb(95, 212, 255)`;
   * retuning it is a deliberate edit of that test, not an incidental one.
   */
  accent: "#5fd4ff",
  selectionWhite: "#e8f1ff",

  shadowDeep: "rgba(0, 0, 0, 0.55)",
  shadowSoft: "rgba(0, 0, 0, 0.32)",

  river: "#1d4e6b",
  nodeStroke: "#0b0f14",
  road: "#4c6378",
  footpath: "#3c5a44",
  rail: "#7a6ea8",
  tunnel: "#6b5a4a",
  bridge: "#d9e2ec",
  downtown: "#5fb0d9",
  residential: "#7fbf7f",
  suburb: "#b5c46a",
  industrial: "#b58a5a",
  park: "#4f9a6a",
  transitHub: "#c07fc0",
} as const;

/**
 * Two families, per DESIGN.md. `family` is the monospace stack the report feed and every timestamp
 * read, because a dispatch log reads as a log; `familyDisplay` is the heavy condensed stack for
 * headings, meters and the case number. System fonts only, with the condensed faces listed before
 * a `system-ui` fallback, because AGENTS.md forbids a webfont network request.
 *
 * Token names carry no `font` prefix because the group already does: `cssvariables.ts` publishes
 * `font.sizeBase` as `--mh-font-size-base`, and `fontSizeBase` would have made it
 * `--mh-font-font-size-base`.
 */
export const TYPE_SCALE = {
  family: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  familyDisplay:
    '"Archivo Narrow", "Roboto Condensed", "Liberation Sans Narrow", "Arial Narrow", system-ui, sans-serif',

  sizeXs: "0.72rem",
  sizeSmall: "0.85rem",
  sizeBase: "1rem",
  sizeLarge: "1.25rem",
  sizeDisplay: "1.75rem",
  sizeHero: "2.5rem",

  weightRegular: "400",
  weightBold: "700",
  weightBlack: "900",

  trackingWide: "0.08em",
  trackingTight: "-0.01em",

  lineHeightTight: "1.15",
  lineHeightBase: "1.5",
} as const;

/** One spacing scale for every gap, pad and inset the frame uses. */
export const SPACE = {
  hair: "0.125rem",
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  xxl: "2.5rem",
} as const;

/** Payday is hard-edged. Corners are a chamfer at most, never a pill. */
export const RADIUS = {
  none: "0",
  chip: "2px",
  card: "3px",
} as const;

/** Raised planes, composed from `PALETTE`'s two shadow tokens plus the hairline edge. */
export const SHADOW = {
  panel: `inset 0 1px 0 ${PALETTE.edgeHairline}, 0 1px 2px ${PALETTE.shadowSoft}`,
  card: `inset 0 1px 0 ${PALETTE.edgeHairline}, 0 6px 18px ${PALETTE.shadowDeep}`,
  focusRing: `0 0 0 2px ${PALETTE.background}, 0 0 0 4px ${PALETTE.accent}`,
} as const;

/**
 * Motion is confirmation, never decoration (DESIGN.md). Every duration here is applied behind a
 * `prefers-reduced-motion` guard in `index.css`; the tokens exist so no component invents its own
 * timing and so the guard has one set of things to switch off.
 */
export const MOTION = {
  durationInstant: "90ms",
  durationFast: "160ms",
  durationBase: "240ms",
  durationSlow: "420ms",
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeStandard: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/**
 * The groups that become CSS custom properties, keyed by the prefix each group takes. Every value
 * is a string, because a custom property is a string; the numeric tokens below (`STROKE`,
 * `MAP_THEME`) are SVG attributes read from TypeScript and are deliberately not in here.
 */
export const DESIGN_TOKENS = {
  color: PALETTE,
  font: TYPE_SCALE,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;

/**
 * Stroke weights in SVG user units, so the map has tiers rather than a number per call site. The
 * casing tier is what makes a road read as a road: a `casing` stroke under a `base` stroke, with
 * the glow beneath both.
 */
export const STROKE = {
  hairline: 1,
  thin: 1.5,
  base: 2,
  thick: 3,
  casing: 5,
} as const;

/**
 * SVG user units of Gaussian blur on the glow filter `maprenderer.tsx` defines for road edges
 * ("thin glowing roads"). Blurring `SourceGraphic` and merging the crisp line back on top keeps
 * the glow in each edge kind's own colour with no second colour token to name.
 */
const GLOW_BLUR = 1.5;

const EDGE_STYLES: Readonly<Record<EdgeKind, MapEdgeStyle>> = {
  road: { stroke: PALETTE.road, width: STROKE.base, dash: null },
  footpath: { stroke: PALETTE.footpath, width: STROKE.thin, dash: "3 3" },
  rail: { stroke: PALETTE.rail, width: STROKE.base, dash: "8 4" },
  tunnel: { stroke: PALETTE.tunnel, width: STROKE.base, dash: "1 4" },
  bridge: { stroke: PALETTE.bridge, width: STROKE.thick, dash: null },
};

const DISTRICT_FILLS: Readonly<Record<DistrictType, string>> = {
  downtown: PALETTE.downtown,
  residential: PALETTE.residential,
  suburb: PALETTE.suburb,
  industrial: PALETTE.industrial,
  park: PALETTE.park,
  transit_hub: PALETTE.transitHub,
  exit: PALETTE.exitGold,
};

/** The map's whole palette plus its measurements, in the shape `maprenderer.tsx` declares. */
export const MAP_THEME: MapTheme = {
  padding: 24,
  river: PALETTE.river,
  riverWidth: 6,
  nodeRadius: 6,
  incidentRadius: 9,
  nodeStroke: PALETTE.nodeStroke,
  exitStroke: PALETTE.exitGold,
  incidentStroke: PALETTE.incidentRed,
  markerWidth: 2.5,
  selectionStroke: PALETTE.selectionWhite,
  selectionWidth: STROKE.base,
  selectionGap: 4,
  blockedStroke: PALETTE.incidentRed,
  blockedRadius: 3.5,
  glowBlur: GLOW_BLUR,
  edges: EDGE_STYLES,
  districts: DISTRICT_FILLS,
};

/**
 * DESIGN.md's "red heatmap". Its fill is `PALETTE.incidentRed`, the same red as the map's
 * incident marker and standing roadblocks, so there is one red in the app to tune, not several
 * that happen to match by coincidence.
 */
export const HEAT_RAMP: HeatRamp = {
  fill: PALETTE.incidentRed,
  minRadius: 5,
  maxRadius: 18,
  minOpacity: 0.06,
  maxOpacity: 0.55,
};

/** Gold against the map's red heatmap, so the criminal's current position reads apart from it. */
export const CRIMINAL_PATH_THEME: CriminalPathTheme = {
  trailStroke: PALETTE.incidentRed,
  trailWidth: STROKE.base,
  markerFill: PALETTE.exitGold,
  markerStroke: PALETTE.nodeStroke,
  markerStrokeWidth: STROKE.base,
  markerRadius: 7,
};
