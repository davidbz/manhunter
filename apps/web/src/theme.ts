/**
 * `apps/web`'s single palette, type scale and heat ramp (PLAN M5.7): the token file every
 * dispatch component reads instead of writing its own colour or font literal, and the one place
 * DESIGN.md's "Visual direction" - dark background, thin glowing roads, red heatmap, monospace
 * report feed - is stated.
 *
 * Before this task the same hex values were copied by hand into three files, each with its own
 * note promising this file would absorb it: `maprenderer.tsx`'s `DEFAULT_MAP_THEME`,
 * `beliefoverlay.tsx`'s `DEFAULT_HEAT_RAMP`, `criminalpath.tsx`'s `DEFAULT_CRIMINAL_PATH_THEME`.
 * All three now import their default from here; the type each default satisfies stays declared
 * in the component that owns the contract (`MapTheme`, `HeatRamp`, `CriminalPathTheme`), the way
 * `MapRendererProps` and the rest of that component's shape already do.
 *
 * `packages/sim/src/svg.ts` carries a fourth copy, `DEFAULT_SVG_THEME`, for the standalone map
 * debug export, and it cannot import this file: architecture rule 5 lets `apps/web` depend on
 * `packages/core` only (never the other way, and never on `packages/sim`), and there is no third
 * location either side could move the palette to - `core` holds no presentation strings
 * (architecture rule 1). Left alone; the drift this task's Inbox item warned about is now between
 * this file and that one, not between three files and one. See the note this task leaves in the
 * Inbox.
 */

import type { DistrictType, EdgeKind } from "@manhunter/core";
import type { HeatRamp } from "./beliefoverlay";
import type { CriminalPathTheme } from "./criminalpath";
import type { MapEdgeStyle, MapTheme } from "./maprenderer";

/**
 * Raw colour tokens. Every colour literal (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`) anywhere
 * under `apps/web/src` lives here and nowhere else - `tools/theme/colorliterals.test.ts` scans
 * the rest of the tree and fails if one leaks back out.
 */
export const PALETTE = {
  background: "#0b0f14",
  text: "#e8f1ff",
  textMuted: "#93a5ba",
  river: "#1d4e6b",
  nodeStroke: "#0b0f14",
  exitGold: "#f2b134",
  incidentRed: "#e8483f",
  selectionWhite: "#e8f1ff",
  accent: "#5fd4ff",
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
 * DESIGN.md's "monospace report feed", applied at the document root in `main.tsx` so every panel
 * inherits it rather than one corner of the screen alone - a tactical dispatch screen is not a
 * sans-serif app with one monospace widget. System fonts only, no webfont network request
 * (AGENTS.md "Things not to do": no network calls).
 */
export const TYPE_SCALE = {
  fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  fontSizeBase: "1rem",
  fontSizeSmall: "0.85rem",
} as const;

/**
 * SVG user units of Gaussian blur on the glow filter `maprenderer.tsx` defines for road edges
 * ("thin glowing roads"). Blurring `SourceGraphic` and merging the crisp line back on top keeps
 * the glow in each edge kind's own colour with no second colour token to name.
 */
const GLOW_BLUR = 1.5;

const EDGE_STYLES: Readonly<Record<EdgeKind, MapEdgeStyle>> = {
  road: { stroke: PALETTE.road, width: 2, dash: null },
  footpath: { stroke: PALETTE.footpath, width: 1.5, dash: "3 3" },
  rail: { stroke: PALETTE.rail, width: 2, dash: "8 4" },
  tunnel: { stroke: PALETTE.tunnel, width: 2, dash: "1 4" },
  bridge: { stroke: PALETTE.bridge, width: 3, dash: null },
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
  selectionWidth: 2,
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
  trailWidth: 2,
  markerFill: PALETTE.exitGold,
  markerStroke: PALETTE.nodeStroke,
  markerStrokeWidth: 2,
  markerRadius: 7,
};
