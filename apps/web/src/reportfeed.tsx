/**
 * What the hunter has been told, newest first (PLAN M5.4). Every line carries both of a report's
 * timestamps, because the gap between them is the game: "information is late and unreliable" is
 * DESIGN.md's first pillar, and a feed that showed only the arrival would hide it.
 *
 * Presentational and controlled, the way `maprenderer.tsx` is: props are data, the component holds
 * no state, and `reportfeedpanel.tsx` is the thin half that knows about the store. "New" is
 * derived from `currentTurn`, never stored, so a re-render cannot leave a stale highlight behind.
 *
 * **Nothing here may depend on what a report is.** `HunterReport` carries no `truth` and no
 * `accuracy`, and `HunterEvent` collapses to `report_arrived` precisely so the feed cannot leak a
 * prank (PLAN "GameEvent leaks which report is a prank"). Ordering, grouping and styling therefore
 * read only `receivedAtTurn`, `observedAtTurn`, `source` and `content` - the four fields the
 * player is meant to reason from. Telling a prank from a sighting stays the player's job.
 *
 * DESIGN.md's "monospace report feed": `theme.ts`'s `TYPE_SCALE.fontFamily` is set on the whole
 * document at the composition root (PLAN M5.7's `main.tsx` note), so the feed inherits it like
 * everything else; it is restated here so the feed is still monospace if it is ever rendered
 * somewhere that font is not already the default, and the timestamps use the smaller size in the
 * same table to read as a log rather than as body text.
 */

import type { HunterReport, NodeId, ReportContent, ReportSource, Turn } from "@manhunter/core";
import { LIMITS } from "./limits";
import { TYPE_SCALE } from "./theme";

export type ReportFeedProps = {
  readonly reports: readonly HunterReport[];
  /** The turn the view is at. A report received on it is the new one. */
  readonly currentTurn: Turn;
  /**
   * How many lines the feed will hold. Defaults to the bound `limits.ts` declares; a caller may
   * ask for fewer, never for more than it passes in.
   */
  readonly maxEntries?: number;
};

export const REPORT_FEED_TEST_ID = "report-feed";
export const REPORT_FEED_EMPTY_TEST_ID = "report-feed-empty";
export const REPORT_FEED_OVERFLOW_TEST_ID = "report-feed-overflow";
export const REPORT_ENTRY_TEST_ID = "report-entry";
export const REPORT_OBSERVED_TEST_ID = "report-observed";
export const REPORT_RECEIVED_TEST_ID = "report-received";
export const REPORT_CONTENT_TEST_ID = "report-content";

/**
 * Every user-facing word the feed says, in one table. `core` has no strings (see `report.ts`), so
 * the wording is the UI's, and keeping it here is what stops a source or a content kind being
 * spelled two ways in two places. PLAN M5.7 owns the palette; this is its counterpart for text.
 */
export const REPORT_SOURCE_LABELS: Readonly<Record<ReportSource, string>> = {
  witness: "Witness",
  cctv: "CCTV",
  tip: "Tip",
  patrol: "Patrol",
};

export const REPORT_CONTENT_LABELS: Readonly<Record<ReportContent["kind"], string>> = {
  sighting: "Sighting",
  no_sighting: "Nothing seen",
};

const FEED_LABEL = "Report feed";
const EMPTY_TEXT = "No reports yet";
const OBSERVED_PREFIX = "Observed turn ";
const RECEIVED_PREFIX = "Received turn ";
const AT_SEPARATOR = " at ";
const MODE_OPEN = " (";
const MODE_CLOSE = ")";
const OVERFLOW_SUFFIX = " older reports not shown";

const NONE = 0;

/** The reports the feed will draw, plus however many it had to leave out. */
export type ReportPage = {
  readonly entries: readonly HunterReport[];
  readonly withheld: number;
};

/**
 * Newest arrival first, capped at `maxEntries`.
 *
 * The cap **keeps the most recent and declares the rest** rather than refusing the render, which
 * is the one place this file departs from AGENTS.md's "oversized input is an error, not a
 * truncation". That rule bounds input crossing a trust boundary, where a truncated parse is a
 * silently wrong value; this list is data the app already holds, produced by `core` and already
 * bounded by the hunt's own turn count, and the thing `LIMITS.maxReportsInFeed` protects is the
 * number of DOM nodes. Refusing to draw would cost the player the intel the whole screen exists
 * for. `withheld` is what keeps the cap from being silent: the feed says how much it is not
 * showing, so a truncation is visible rather than inferred.
 *
 * Sorting is stable and reads `receivedAtTurn` alone, so two reports that landed together stay in
 * the order `core` produced them and nothing about their nature can reorder them.
 */
export const reportPageOf = (reports: readonly HunterReport[], maxEntries: number): ReportPage => {
  const kept = Math.max(maxEntries, NONE);
  const entries = [...reports]
    .sort((left, right) => right.receivedAtTurn - left.receivedAtTurn)
    .slice(NONE, kept);

  return { entries, withheld: reports.length - entries.length };
};

type ContentLine = {
  readonly label: string;
  readonly nodeId: NodeId;
  /** Only a sighting has one, and an unmade-out mode is the string `core` gives it. */
  readonly travelMode: string | null;
};

const contentLineOf = (content: ReportContent): ContentLine => {
  switch (content.kind) {
    case "sighting":
      return {
        label: REPORT_CONTENT_LABELS.sighting,
        nodeId: content.nodeId,
        travelMode: content.travelMode,
      };
    case "no_sighting":
      return {
        label: REPORT_CONTENT_LABELS.no_sighting,
        nodeId: content.nodeId,
        travelMode: null,
      };
    default: {
      const unhandled: never = content;
      return unhandled;
    }
  }
};

const contentTextOf = (line: ContentLine): string => {
  const placed = `${line.label}${AT_SEPARATOR}${line.nodeId}`;
  if (line.travelMode === null) return placed;

  return `${placed}${MODE_OPEN}${line.travelMode}${MODE_CLOSE}`;
};

const ReportEntry = ({
  report,
  isNew,
}: {
  readonly report: HunterReport;
  readonly isNew: boolean;
}) => (
  <li
    data-testid={REPORT_ENTRY_TEST_ID}
    data-reportid={report.id}
    data-source={report.source}
    data-observed={report.observedAtTurn}
    data-received={report.receivedAtTurn}
    data-new={isNew}
  >
    <span
      data-testid={REPORT_OBSERVED_TEST_ID}
      style={{ fontSize: TYPE_SCALE.fontSizeSmall }}
    >{`${OBSERVED_PREFIX}${report.observedAtTurn}`}</span>
    <span
      data-testid={REPORT_RECEIVED_TEST_ID}
      style={{ fontSize: TYPE_SCALE.fontSizeSmall }}
    >{`${RECEIVED_PREFIX}${report.receivedAtTurn}`}</span>
    <span>{REPORT_SOURCE_LABELS[report.source]}</span>
    <span data-testid={REPORT_CONTENT_TEST_ID}>{contentTextOf(contentLineOf(report.content))}</span>
  </li>
);

export const ReportFeed = ({
  reports,
  currentTurn,
  maxEntries = LIMITS.maxReportsInFeed,
}: ReportFeedProps) => {
  const page = reportPageOf(reports, maxEntries);

  return (
    <section
      aria-label={FEED_LABEL}
      data-testid={REPORT_FEED_TEST_ID}
      style={{ fontFamily: TYPE_SCALE.fontFamily }}
    >
      {page.entries.length === NONE ? (
        <p data-testid={REPORT_FEED_EMPTY_TEST_ID}>{EMPTY_TEXT}</p>
      ) : (
        <ol>
          {page.entries.map((report) => (
            <ReportEntry
              key={report.id}
              report={report}
              isNew={report.receivedAtTurn === currentTurn}
            />
          ))}
        </ol>
      )}
      {page.withheld > NONE ? (
        <p data-testid={REPORT_FEED_OVERFLOW_TEST_ID} data-withheld={page.withheld}>
          {`${page.withheld}${OVERFLOW_SUFFIX}`}
        </p>
      ) : null}
    </section>
  );
};
