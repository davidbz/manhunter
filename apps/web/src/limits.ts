import { LIMITS as CORE_LIMITS } from "@manhunter/core";

/**
 * Bounds for every boundary `web` crosses, per AGENTS.md "Bound every I/O up front":
 * replay strings from the URL, the report feed the UI retains, the action log the store
 * accumulates, and the text the debrief hands the clipboard. Oversized input is an error result,
 * never a truncation.
 *
 * **Settled at PLAN M5.6b-2**, closing five standing Inbox entries at once: `core` now exports
 * `LIMITS`, and every bound below that exists to agree with a `core` bound reads that field
 * directly instead of carrying its own copy, so the two cannot drift apart the way the Inbox
 * entries for `maxReplayStringLength`, `maxRecordedTurns` and `maxQueuedActions` each warned
 * they could. `maxReportsInFeed` and `maxSeedInputLength` stay local literals: neither pairs
 * with a single named `core` constant (the seed bound is the RNG's implicit 32-bit range, not a
 * `LIMITS` field, and the feed bound is a defensive cap `core` states no opinion on at all), so
 * importing `core`'s `LIMITS` gives them nothing to read.
 */
export const LIMITS = {
  /** Characters accepted from a replay URL before decoding is refused (PLAN M3.9, M5.6b-2). */
  maxReplayStringLength: CORE_LIMITS.maxReplayStringLength,
  /** Reports the feed keeps in memory (PLAN M5.4). */
  maxReportsInFeed: 500,
  /**
   * Turns the store will record actions for (PLAN M5.2). A hunt with no outcome has no deadline
   * rule to stop it, so the log is what grows. Reads `core`'s `LIMITS.maxGameTurns` directly,
   * which is what `replayRefusalIn` bounds a recorded turn list by: a longer log is one no
   * replay could carry.
   */
  maxRecordedTurns: CORE_LIMITS.maxGameTurns,
  /**
   * Characters accepted from the new-hunt seed field before the seed is refused (PLAN M5.5a).
   * The seed is the one number the player types, so it arrives from outside and is bounded
   * before it is parsed; an entry over this is an error result, never a truncation.
   * Ten digits is the whole unsigned 32-bit range the RNG seeds from and keeps every accepted
   * seed inside `Number.MAX_SAFE_INTEGER`, so no second bound on the value is needed.
   */
  maxSeedInputLength: 10,
  /**
   * Actions one turn's queue may hold before the board refuses to take another (PLAN M5.5b).
   * The queue is built one click at a time, so it is user input and is bounded where it
   * accumulates rather than after it is handed over. Reads `core`'s `LIMITS.maxQueuedActions`
   * directly, which is what `step` refuses a longer queue by: a queue this side accepted and
   * that side refused would cost the player the whole turn instead of one row.
   */
  maxQueuedActions: CORE_LIMITS.maxQueuedActions,
  /**
   * Sites `districtCellsOf` will clip cells for (PLAN M6.3). Every cell is clipped against every
   * other site, so the work is quadratic in this. Reads `core`'s `LIMITS.maxMapNodes` directly:
   * one site per node, and a map `core` would refuse to generate is one no cell set need cover.
   */
  maxDistrictCellSites: CORE_LIMITS.maxMapNodes,
  /**
   * River polyline points `riverChannelOf` will offset into a channel (PLAN M6.4). Bridge decks
   * test every bridge against every river segment, so this bounds that work too. `core` draws
   * two points per step of the staircase and a step per grid row or column, so a river on a map
   * `core` would generate never has more than two per node.
   */
  maxRiverPoints: CORE_LIMITS.maxMapNodes * 2,
  /**
   * Report pins the map draws at once (PLAN M6.6), freshest node first; the rest are counted in
   * the layer's `data-withheld`, the feed's truncate-and-declare rule, because the reports are
   * in-memory data `core` produced rather than input crossing a boundary. One pin per node, so
   * the map's node count bounds it too; this keeps a long hunt's pins from crowding the plate.
   */
  maxReportPins: 24,
  /**
   * Rows each of the heatmap's text lists reads out (PLAN M6.10): the most suspected districts,
   * and the reports pinned on the map. The rest are counted, never listed - the feed's
   * truncate-and-declare rule. Five is what a screen-reader user can hold while deciding where to
   * send a patrol; every
   * node's own label is still on the map's node list for the rest.
   */
  maxHeatmapSummaryEntries: 5,
  /**
   * Characters the debrief will write to the clipboard in one copy (PLAN M6.9). What it copies is
   * a share link: the page's own URL plus a replay string `core` already caps at
   * `maxReplayStringLength`, so twice that leaves the origin and path far more room than any real
   * one needs while still refusing, before the write, a text no link could have produced.
   */
  maxClipboardTextLength: CORE_LIMITS.maxReplayStringLength * 2,
  /**
   * Milliseconds a clipboard write may stay pending before the copy is reported as timed out
   * (PLAN M6.9). The browser can hold `writeText` open behind a permission prompt the player never
   * answers, and a button that waits on it for ever is a button that silently does nothing.
   */
  maxClipboardWriteMilliseconds: 3000,
} as const;
