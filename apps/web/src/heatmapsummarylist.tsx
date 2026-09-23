/**
 * The heatmap's text equivalent (PLAN M6.10), presentational: `heatmapsummary.ts` decides what is
 * said, this says it. Visually hidden rather than hidden, because the picture already says it to
 * a sighted player and the point is that a screen reader hears the same thing; the lists are
 * named, so a reader can jump to them from the landmark list rather than tab through the map.
 *
 * Wording is shared with the feed (`REPORT_CONTENT_LABELS`, `REPORT_SOURCE_LABELS`, `ageText`), so
 * a report reads the same in the feed and in this list.
 */

import type { HeatmapSummary, PinnedReport, SuspectedDistrict } from "./heatmapsummary";
import { ageText, REPORT_CONTENT_LABELS, REPORT_SOURCE_LABELS } from "./reportfeed";

export const HEATMAP_SUMMARY_TEST_ID = "heatmap-summary";
export const HEATMAP_SUSPECT_TEST_ID = "heatmap-summary-suspect";
export const HEATMAP_REPORT_TEST_ID = "heatmap-summary-report";
export const HEATMAP_WITHHELD_TEST_ID = "heatmap-summary-withheld";

const SUMMARY_LABEL = "Map summary";
const SUSPECTS_LABEL = "Most suspected districts";
const REPORTS_LABEL = "Reports pinned on the map";
const NO_SUSPECTS_TEXT = "No district is suspected yet";
const NO_REPORTS_TEXT = "No reports pinned";
const TOP_TIER_TEXT = ", top tier";
const UNDER_ONE_PERCENT_TEXT = "under 1%";
const PERCENT_SUFFIX = "%";
const NAME_SEPARATOR = " - ";
const LABEL_SEPARATOR = ", ";
const AT_TEXT = " at ";
const FROM_TEXT = " from ";
const REPORTS_SUFFIX = " reports here";
const WITHHELD_SUFFIX = " more not listed";

const NONE = 0;
const SINGLE = 1;

const placeOf = (nodeId: string, district: string | null): string =>
  district === null ? nodeId : `${nodeId}${NAME_SEPARATOR}${district}`;

export const suspectTextOf = (suspect: SuspectedDistrict): string => {
  const share =
    suspect.percent === NONE ? UNDER_ONE_PERCENT_TEXT : `${suspect.percent}${PERCENT_SUFFIX}`;
  const tier = suspect.topTier ? TOP_TIER_TEXT : "";

  return `${placeOf(suspect.nodeId, suspect.district)}: ${share}${tier}`;
};

export const reportTextOf = (report: PinnedReport): string => {
  const parts = [
    `${REPORT_CONTENT_LABELS[report.kind]}${AT_TEXT}${placeOf(report.nodeId, report.district)}`,
    `${ageText(report.age)}${FROM_TEXT}${REPORT_SOURCE_LABELS[report.source]}`,
  ];
  if (report.count > SINGLE) parts.push(`${report.count}${REPORTS_SUFFIX}`);

  return parts.join(LABEL_SEPARATOR);
};

type SummaryListProps = {
  readonly label: string;
  readonly empty: string;
  readonly rows: readonly { readonly key: string; readonly text: string }[];
  readonly withheld: number;
  readonly rowTestId: string;
};

const SummaryList = ({ label, empty, rows, withheld, rowTestId }: SummaryListProps) => (
  <ul aria-label={label}>
    {rows.length === NONE ? <li>{empty}</li> : null}
    {rows.map((row) => (
      <li key={row.key} data-testid={rowTestId}>
        {row.text}
      </li>
    ))}
    {withheld > NONE ? (
      <li data-testid={HEATMAP_WITHHELD_TEST_ID}>{`${withheld}${WITHHELD_SUFFIX}`}</li>
    ) : null}
  </ul>
);

export const HeatmapSummaryList = ({ summary }: { readonly summary: HeatmapSummary }) => (
  <section
    aria-label={SUMMARY_LABEL}
    className="mh-visually-hidden"
    data-testid={HEATMAP_SUMMARY_TEST_ID}
  >
    <SummaryList
      label={SUSPECTS_LABEL}
      empty={NO_SUSPECTS_TEXT}
      rows={summary.suspects.entries.map((each) => ({
        key: each.nodeId,
        text: suspectTextOf(each),
      }))}
      withheld={summary.suspects.withheld}
      rowTestId={HEATMAP_SUSPECT_TEST_ID}
    />
    <SummaryList
      label={REPORTS_LABEL}
      empty={NO_REPORTS_TEXT}
      rows={summary.reports.entries.map((each) => ({
        key: each.nodeId,
        text: reportTextOf(each),
      }))}
      withheld={summary.reports.withheld}
      rowTestId={HEATMAP_REPORT_TEST_ID}
    />
  </section>
);
