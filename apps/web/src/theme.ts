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

import type { DistrictType, EdgeKind, ExitKind, TimeOfDay } from "@manhunter/core";
import type { ActionIconTheme } from "./actionicon";
import type { AvatarTheme } from "./avatarportrait";
import type { BeliefLegendTheme } from "./belieflegend";
import type { BeliefFieldTheme, HeatRamp } from "./beliefoverlay";
import type { CriminalPathTheme } from "./criminalpath";
import type { FeedRowTheme } from "./feedrow";
import type { MapBlockStyle, MapEdgeStyle, MapTheme, MapWashStyle } from "./maprenderer";
import type { MapReportPinStyle } from "./mapreportpins";
import type { MeterTheme } from "./meters";
import type { TransportIconTheme } from "./replayscrubber";

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
  /**
   * The quietest text tone: order numbers, a stale report, a resource the hunter is short of.
   * Retuned from `#5e7288` by PLAN M6.10's contrast audit (`contrast.test.ts`), which measured
   * the old value at 3.1:1 on a card; this one clears 4.5:1 on every surface, so "dim" is a step
   * down from `textMuted`, never a step below legible.
   */
  textDim: "#7a8fa5",

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

  /**
   * District block tones (PLAN M6.4): the marker hues above pushed most of the way to the ground,
   * so a block says what kind of place it is without competing with the roads drawn across it.
   * Types differ by hatch angle and spacing as well as by tone, so hue is never the only channel.
   */
  blockDowntown: "#1c2c3a",
  blockResidential: "#223024",
  blockSuburb: "#2c2f22",
  blockIndustrial: "#322a21",
  blockPark: "#18301f",
  blockTransitHub: "#2c2333",
  blockExit: "#3a3120",
  blockHatch: "#50657a",
  riverBank: "#123247",
  riverCurrent: "#2f6e91",
  bridgeDeck: "#2a3846",
  /** The night wash laid over the plate after dark: a deep blue, never a hue of its own. */
  nightWash: "#02060f",

  /**
   * Avatar skin tones, greyed toward the surface ramp so a face never out-shouts the map. They are
   * the only non-map hues outside the discipline above, and they are deliberately desaturated.
   */
  skinPale: "#c2ab9c",
  skinWarm: "#a08674",
  skinTan: "#7c6556",
  skinDeep: "#54453c",

  /**
   * Mask channels, not paint (PLAN M6.8). A CSS `mask-image` reads only alpha, so these two are
   * the opaque and the clear stop of the gradient that cuts a meter into segments. Named rather
   * than written as `black`/`transparent` so the stylesheet stays keyword-free as well as
   * literal-free.
   */
  maskInk: "#000000",
  maskClear: "rgba(0, 0, 0, 0)",
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

const DURATION_FAST = "160ms";
const DURATION_BASE = "240ms";
const DURATION_SLOW = "420ms";

/**
 * Motion is confirmation, never decoration (DESIGN.md). Every duration here is applied behind a
 * `prefers-reduced-motion` guard in `index.css`; the tokens exist so no component invents its own
 * timing and so the guard has one set of things to switch off.
 *
 * The five named moments below (PLAN M6.10) are the only things that move, and each confirms
 * something the player did or was told: the turn they ended advanced, a report they paid for
 * arrived, a meter they spent from moved, a checkpoint they ordered went up, and the hunt they
 * ran ended. `tools/theme/reducedmotion.test.ts` holds every one of them to the guard.
 */
export const MOTION = {
  durationInstant: "90ms",
  durationFast: DURATION_FAST,
  durationBase: DURATION_BASE,
  durationSlow: DURATION_SLOW,
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeStandard: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** How much larger the map's selection reticle starts before it locks on (PLAN M6.5). */
  lockOnScale: "1.6",
  /** The rail's clock turning over to the next hour. */
  turnAdvance: DURATION_BASE,
  /** A new feed row sliding in, and its pin landing on the map. */
  reportArrival: DURATION_SLOW,
  /** A meter's reading flashing the accent as it changes. */
  meterMovement: DURATION_SLOW,
  /**
   * A checkpoint's barrier dropping onto the road. The hunter is never told a checkpoint fired on
   * the criminal (architecture rule 4), so the moment the player sees is the barrier going live.
   */
  checkpointFire: DURATION_BASE,
  /** The debrief's verdict banner landing, then the tally under it. */
  outcomeSting: DURATION_SLOW,
  /** How far an arriving element travels to its place: a feed row, the rail's reading, the banner. */
  arrivalOffset: "0.5rem",
} as const;

/**
 * The operations-board frame's geometry (PLAN M6.2). The map is the hero (DESIGN.md), so it gets
 * whatever is left once the rail, the intel column and the command bar have taken their share;
 * these are the shares. The intel column and the command bar are clamped rather than fixed so the
 * map keeps the dominant column from 1280x800 up to 1920x1080 without either panel starving.
 *
 * `frameHeight` is `dvh` rather than `vh` so a browser's collapsing toolbar cannot push the
 * command bar, and End Turn with it, below the fold.
 */
export const LAYOUT = {
  frameHeight: "100dvh",
  intelWidth: "clamp(18rem, 24vw, 28rem)",
  commandMaxHeight: "clamp(10rem, 32dvh, 20rem)",
  commandColumnMin: "14rem",
  /** The narrowest an action tile gets before the board wraps to another row (PLAN M6.8). */
  tileMin: "9.5rem",
  /** A stencil icon on an action tile or a dispatch-order line. */
  iconSize: "1.5rem",
  /** The map legend's ramp and contour swatches, and its pin swatches (PLAN M6.6). */
  legendRampWidth: "2.5rem",
  legendRampHeight: "0.5rem",
  legendPin: "1rem",
  /**
   * The briefing and the debrief (PLAN M6.9). The briefing is a readable column rather than the
   * full width; the debrief's side column holds the dossier, the share link and restart; the
   * replay map keeps a floor so a short viewport scrolls the debrief rather than crushing the
   * city; and a share link long enough to wrap for lines scrolls inside its own box.
   */
  briefingWidth: "64rem",
  briefingSideWidth: "clamp(16rem, 26vw, 20rem)",
  debriefSideWidth: "clamp(16rem, 24vw, 24rem)",
  replayMapMin: "16rem",
  shareUrlMaxHeight: "6rem",
} as const;

/** Rule weights for the panel chrome (PLAN M6.8): a hairline between rows, a heavy edge for state. */
export const BORDER = {
  hairline: "1px",
  heavy: "3px",
} as const;

/**
 * How far an element recedes when it is out of play (PLAN M6.8): a stale report pin, an action
 * the hunter cannot afford. A stale feed row is not faded (PLAN M6.10's contrast audit). Opacity rather than a new grey, so the element keeps its own colours.
 */
export const FADE = {
  /** A report pin a few turns old (PLAN M6.6), between fresh and stale. */
  aging: "0.8",
  stale: "0.55",
  disabled: "0.45",
} as const;

/**
 * The segmented meters (PLAN M6.8). `segments` is the count a scaled meter - budget, trust,
 * pressure - is cut into; a meter measured in whole units (action points, turns) overrides it on
 * the element with one segment per unit, which `meters.tsx` decides.
 */
export const METER = {
  height: "0.875rem",
  segmentGap: "3px",
  segments: "10",
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
  layout: LAYOUT,
  border: BORDER,
  fade: FADE,
  meter: METER,
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

/**
 * Casing plus fill (PLAN M6.4): a dark `casingWidth` stroke under a bright `width` stroke, with
 * the glow beneath both. Kinds differ by width and dash as well as by hue, so the map survives a
 * reader who cannot separate the hues: a road is solid and wide, a footpath narrow and dotted, a
 * rail a dashed fill over a solid casing (sleepers on a bed), a tunnel dashed in both, and a
 * bridge the widest of all.
 */
const EDGE_STYLES: Readonly<Record<EdgeKind, MapEdgeStyle>> = {
  road: { stroke: PALETTE.road, width: 2.5, dash: null, casingWidth: 6, casingDash: null },
  footpath: {
    stroke: PALETTE.footpath,
    width: STROKE.thin,
    dash: "3 3",
    casingWidth: 3.5,
    casingDash: null,
  },
  rail: { stroke: PALETTE.rail, width: STROKE.base, dash: "8 4", casingWidth: 5, casingDash: null },
  tunnel: {
    stroke: PALETTE.tunnel,
    width: STROKE.base,
    dash: "1 4",
    casingWidth: 5,
    casingDash: "6 3",
  },
  bridge: {
    stroke: PALETTE.bridge,
    width: STROKE.thick,
    dash: null,
    casingWidth: 7,
    casingDash: null,
  },
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

/**
 * One block treatment per district type (PLAN M6.4). Angles are degrees, spacings map units; the
 * dense grain is downtown's and the open grain the suburbs' and parks', so density reads as
 * density before the tone does.
 */
const DISTRICT_BLOCKS: Readonly<Record<DistrictType, MapBlockStyle>> = {
  downtown: { tone: PALETTE.blockDowntown, hatchAngle: 45, hatchSpacing: 5 },
  residential: { tone: PALETTE.blockResidential, hatchAngle: 45, hatchSpacing: 9 },
  suburb: { tone: PALETTE.blockSuburb, hatchAngle: 135, hatchSpacing: 14 },
  industrial: { tone: PALETTE.blockIndustrial, hatchAngle: 90, hatchSpacing: 7 },
  park: { tone: PALETTE.blockPark, hatchAngle: 135, hatchSpacing: 18 },
  transit_hub: { tone: PALETTE.blockTransitHub, hatchAngle: 0, hatchSpacing: 6 },
  exit: { tone: PALETTE.blockExit, hatchAngle: 45, hatchSpacing: 4 },
};

/**
 * The wash over the plate per `TimeOfDay` (PLAN M6.4). Day is clear; night lays deep blue over
 * the ground and every block, because a park at night has no witnesses at all
 * (`balance.districts.park.nightWitnessMultiplier` is 0) and the plan should look it.
 */
const DAYLIGHT_WASH: Readonly<Record<TimeOfDay, MapWashStyle>> = {
  day: { fill: PALETTE.nightWash, opacity: 0 },
  night: { fill: PALETTE.nightWash, opacity: 0.5 },
};

/**
 * Exit glyphs, hand-authored stroke paths on a 16-unit square (PLAN M6.4). `ExitKind` is flavour
 * no MVP rule reads (`districts.ts`), which is what makes it free iconography: an aircraft, an
 * anchor, a boom barrier, a two-lane road.
 */
const EXIT_GLYPHS: Readonly<Record<ExitKind, string>> = {
  airport: "M8 1.5 V14.5 M1.5 9.5 L8 6 L14.5 9.5 M5 14.5 L8 12.5 L11 14.5",
  port: "M8 4.5 V14 M5 7 H11 M2.5 10 Q2.5 14 8 14 Q13.5 14 13.5 10 M6.5 3 A1.5 1.5 0 1 1 9.5 3 A1.5 1.5 0 1 1 6.5 3",
  border: "M2.5 14.5 V3.5 M2.5 6 H14 V10 H2.5 M5.5 6 L8 10 M9.5 6 L12 10",
  highway: "M5 1.5 L2 14.5 M11 1.5 L14 14.5 M8 1.5 V4 M8 6.5 V9.5 M8 12 V14.5",
};

/**
 * District glyphs for the unit pips (PLAN M6.5), stroke paths on the same 16-unit square as the
 * exit glyphs: towers, a house, a pair of houses, a sawtooth roof and chimney, a tree, a train,
 * and an arrow out. The pip's district hue is already one channel; the glyph is the second, so a
 * district never reads by colour alone.
 */
const DISTRICT_GLYPHS: Readonly<Record<DistrictType, string>> = {
  downtown: "M2 14.5 V6 H6 V14.5 M6 14.5 V2 H11 V14.5 M11 14.5 V8 H14 V14.5 M1.5 14.5 H14.5",
  residential: "M2.5 8 L8 2.5 L13.5 8 M4 7 V14 H12 V7 M6.5 14 V10 H9.5 V14",
  suburb: "M1.5 9 L4.5 6 L7.5 9 V14 H1.5 Z M8.5 9 L11.5 6 L14.5 9 V14 H8.5 Z",
  industrial: "M1.5 14.5 V8.5 L5 6 V8.5 L8.5 6 V8.5 L12 6 V14.5 H1.5 M12 9 V2 H14.5 V14.5 H12",
  park: "M8 1.5 L3 9.5 H13 Z M8 9.5 V14.5 M5 14.5 H11",
  transit_hub: "M4 2.5 H12 V11 H4 Z M4 7.5 H12 M6 11 L4 14.5 M10 11 L12 14.5",
  exit: "M9 2.5 H13.5 V13.5 H9 M2.5 8 H10.5 M7.5 5 L10.5 8 L7.5 11",
};

/** An exclamation mark on the harm badge, on a 16-unit square. */
const HARM_GLYPH = "M8 3 V9.5 M8 12.5 V13";

/**
 * The feed's row treatments (PLAN M6.8). Ages are turns since the report was observed, the gap
 * DESIGN.md's first pillar is about; weights are `balance.belief.sourceWeight` values, so CCTV
 * (0.9) reads high, patrol and witness (0.6, 0.5) fair, and a tip (0.2) low.
 */
export const FEED_ROW_THEME: FeedRowTheme = {
  agingFromAge: 2,
  staleFromAge: 4,
  highFromWeight: 0.75,
  fairFromWeight: 0.45,
};

/**
 * Recent reports on the map (PLAN M6.6): a teardrop on a 16-unit box with its tip at the bottom
 * centre, standing on the pip's top edge. A sighting carries a filled red dot - a claim about the
 * criminal - and a clearance a muted bar, so the kinds differ by shape as well as by hue. Pinned
 * for five turns, the feed's stale tier and one turn past it, so a pin fades before it goes.
 */
const REPORT_PIN: MapReportPinStyle = {
  size: 18,
  /** Half the pip's 13 units, so the tip lands on the pip's top edge. */
  lift: 6.5,
  glyphBox: 16,
  outline: "M8 16 C6.5 12.5 3 10 3 6.5 A5 5 0 0 1 13 6.5 C13 10 9.5 12.5 8 16 Z",
  plate: PALETTE.surfaceSunken,
  strokeWidth: STROKE.thin,
  markWidth: 2.5,
  kinds: {
    sighting: {
      stroke: PALETTE.text,
      mark: "M8 4.5 A2 2 0 1 1 8 8.5 A2 2 0 1 1 8 4.5 Z",
      markFill: PALETTE.incidentRed,
      markStroke: "none",
    },
    no_sighting: {
      stroke: PALETTE.textMuted,
      mark: "M5.5 6.5 H10.5",
      markFill: "none",
      markStroke: PALETTE.textMuted,
    },
  },
  maxAge: 5,
  staleness: FEED_ROW_THEME,
};

/** The map's whole palette plus its measurements, in the shape `maprenderer.tsx` declares. */
export const MAP_THEME: MapTheme = {
  padding: 24,
  ground: PALETTE.surfaceSunken,
  streetGap: 7,
  blockSeam: STROKE.hairline,
  hatch: PALETTE.blockHatch,
  hatchWidth: STROKE.hairline,
  hatchOpacity: 0.35,
  blocks: DISTRICT_BLOCKS,
  wash: DAYLIGHT_WASH,
  river: {
    water: PALETTE.river,
    width: 22,
    bank: PALETTE.riverBank,
    bankWidth: STROKE.thin,
    current: PALETTE.riverCurrent,
    currentWidth: STROKE.hairline,
    currentDash: "10 8",
    deckFill: PALETTE.bridgeDeck,
    deckStroke: PALETTE.edgeStrong,
    deckStrokeWidth: STROKE.hairline,
    deckWidth: 12,
    deckOverhang: 4,
  },
  exitGate: {
    size: 16,
    offset: 14,
    inset: 2,
    plate: PALETTE.surfaceSunken,
    stroke: PALETTE.exitGold,
    strokeWidth: STROKE.thin,
    glyph: PALETTE.exitGold,
    glyphWidth: STROKE.thin,
    glyphBox: 16,
    glyphs: EXIT_GLYPHS,
  },
  edgeCasing: PALETTE.surfaceSunken,
  pip: {
    size: 13,
    corner: 2,
    inset: 2,
    plate: PALETTE.surfaceSunken,
    strokeWidth: STROKE.thin,
    glyphWidth: STROKE.base,
    glyphBox: 16,
    glyphs: DISTRICT_GLYPHS,
  },
  incidentRing: { radius: 12, stroke: PALETTE.incidentRed, width: STROKE.base },
  focus: { gap: 3, stroke: PALETTE.accent, width: STROKE.base },
  reticle: { gap: 4, tick: 4, stroke: PALETTE.accent, width: STROKE.base },
  selectionStroke: PALETTE.accent,
  checkpoint: {
    length: 16,
    thickness: 5,
    plate: PALETTE.surfaceSunken,
    stroke: PALETTE.accent,
    strokeWidth: STROKE.hairline,
    stripeCount: 4,
    stripeWidth: STROKE.thin,
  },
  harm: {
    radius: 15,
    stroke: PALETTE.incidentRed,
    width: STROKE.thin,
    dash: "3 3",
    badgeSize: 11,
    badgeOffset: 12,
    badgeFill: PALETTE.incidentRed,
    glyph: HARM_GLYPH,
    glyphStroke: PALETTE.surfaceSunken,
    glyphWidth: STROKE.thick,
    glyphInset: 2,
    glyphBox: 16,
  },
  reportPin: REPORT_PIN,
  glowBlur: GLOW_BLUR,
  edges: EDGE_STYLES,
  districts: DISTRICT_FILLS,
};

/**
 * DESIGN.md's "red heatmap". Its fill is `PALETTE.incidentRed`, the same red as the map's
 * incident ring and located harm markers, so there is one red in the app to tune, not several
 * that happen to match by coincidence.
 */
export const HEAT_RAMP: HeatRamp = {
  fill: PALETTE.incidentRed,
  minRadius: 22,
  maxRadius: 56,
  minOpacity: 0.2,
  maxOpacity: 0.85,
};

/**
 * The belief field (PLAN M6.6). Each blob's gradient is full at the centre and gone at the rim, so
 * the radii above are where a blob fades out rather than where it stops; on a 100-unit grid the
 * peak's reaches its neighbours and the field reads as one region. The contour outlines every node
 * at three quarters of the peak or more, in the heat's own red over a dark casing.
 */
export const BELIEF_FIELD: BeliefFieldTheme = {
  stops: [
    { offset: 0, opacity: 1 },
    { offset: 0.4, opacity: 0.7 },
    { offset: 1, opacity: 0 },
  ],
  contourFrom: 0.75,
  contourStroke: PALETTE.incidentRed,
  contourWidth: STROKE.thin,
  contourDash: "6 4",
  contourCasing: PALETTE.surfaceSunken,
  contourCasingWidth: STROKE.thick,
  padding: MAP_THEME.padding,
};

/** The legend's ramp and contour swatches, drawn on a box the stylesheet stretches to size. */
export const BELIEF_LEGEND: BeliefLegendTheme = {
  swatchWidth: 48,
  swatchHeight: 8,
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

/**
 * The avatars' palette (PLAN M6.7), one ramp per `AvatarRamp`, each exactly as long as
 * `avatar.ts`'s `AVATAR_TONE_COUNTS` says. Clothing is drawn from the surface and edge ramp so a
 * portrait stays a panel element; the one saturated tone is the criminal's `mark`, which is
 * `incidentRed` because red is the criminal. The redacted figure is flat surface grey with a
 * darker band, so the unknown suspect reads as a gap in the file rather than as a face.
 */
export const AVATAR_THEME: AvatarTheme = {
  ramps: {
    skin: [PALETTE.skinPale, PALETTE.skinWarm, PALETTE.skinTan, PALETTE.skinDeep],
    garment: [PALETTE.edgeStrong, PALETTE.road, PALETTE.edgeHairline, PALETTE.textDim],
    headwear: [PALETTE.edgeStrong, PALETTE.textDim, PALETTE.road],
    mask: [PALETTE.textDim, PALETTE.road, PALETTE.textMuted],
    mark: [PALETTE.incidentRed],
    eyes: [PALETTE.surfaceSunken],
    redacted: [PALETTE.edgeHairline, PALETTE.surfaceSunken, PALETTE.textDim],
  },
  plate: PALETTE.surfaceSunken,
  plateEdge: PALETTE.edgeStrong,
  plateEdgeWidth: STROKE.hairline,
  portraitSize: 96,
  thumbnailSize: 32,
};

/**
 * How far a whole-unit meter may go before one segment per unit stops reading as chunky (PLAN
 * M6.8). A standard hunt's clock is 24 turns, which is the most segments the board draws; a longer
 * range falls back to `METER.segments`.
 */
export const METER_THEME: MeterTheme = {
  maxUnitSegments: 24,
};

/**
 * Stencil icons for the action board and the dispatch order (PLAN M6.8): hand-authored stroke
 * paths on a 16-unit square, drawn in `currentColor` so a tile's state colours its icon. A
 * striped barrier on legs, a speech bubble, a camera on its bracket, a microphone on a stand.
 */
export const ACTION_ICON_THEME: ActionIconTheme = {
  box: 16,
  strokeWidth: STROKE.thin,
  glyphs: {
    roadblock:
      "M1.5 4.5 H14.5 V9 H1.5 Z M5 4.5 L2.5 9 M9 4.5 L6.5 9 M13 4.5 L10.5 9 M3.5 9 V14.5 M12.5 9 V14.5",
    canvass: "M1.5 2.5 H14.5 V10.5 H7 L3.5 13.5 V10.5 H1.5 Z M4.5 5.5 H11.5 M4.5 7.5 H9.5",
    pull_cctv:
      "M1.5 5 L10.5 2.5 L12 7.5 L3 10 Z M12 4.5 L14.5 4 M7.5 9 L8.5 12.5 H14.5 M14.5 10.5 V14.5",
    true_briefing:
      "M6 1.5 H10 V8.5 H6 Z M4 6.5 V8.5 Q4 11.5 8 11.5 Q12 11.5 12 8.5 V6.5 M8 11.5 V14.5 M5 14.5 H11",
  },
};

/**
 * Transport glyphs for the debrief's replay scrubber (PLAN M6.9), on the action icons' 16-unit
 * square and filled in `currentColor`: a bar and a wedge for the ends, a wedge alone for one step.
 */
export const TRANSPORT_ICON_THEME: TransportIconTheme = {
  box: 16,
  glyphs: {
    first: "M3 3 H5 V13 H3 Z M13 3 L6 8 L13 13 Z",
    previous: "M11.5 3 L4.5 8 L11.5 13 Z",
    next: "M4.5 3 L11.5 8 L4.5 13 Z",
    last: "M3 3 L10 8 L3 13 Z M11 3 H13 V13 H11 Z",
  },
};
