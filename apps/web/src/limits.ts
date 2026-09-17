/**
 * Bounds for every boundary `web` crosses, per AGENTS.md "Bound every I/O up front":
 * replay strings from the URL, and the report feed the UI retains. Oversized input is an
 * error result, never a truncation.
 */
export const LIMITS = {
  /** Characters accepted from a replay URL before decoding is refused (PLAN M3.9, M5.6). */
  maxReplayStringLength: 8_192,
  /** Reports the feed keeps in memory (PLAN M5.4). */
  maxReportsInFeed: 500,
} as const;
