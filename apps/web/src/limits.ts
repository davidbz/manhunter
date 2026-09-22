/**
 * Bounds for every boundary `web` crosses, per AGENTS.md "Bound every I/O up front":
 * replay strings from the URL, the report feed the UI retains, and the action log the store
 * accumulates. Oversized input is an error result, never a truncation.
 */
export const LIMITS = {
  /** Characters accepted from a replay URL before decoding is refused (PLAN M3.9, M5.6). */
  maxReplayStringLength: 8_192,
  /** Reports the feed keeps in memory (PLAN M5.4). */
  maxReportsInFeed: 500,
  /**
   * Turns the store will record actions for (PLAN M5.2). A hunt with no outcome has no deadline
   * rule to stop it, so the log is what grows. Kept equal to `core`'s `LIMITS.maxGameTurns`,
   * which is what `replayRefusalIn` bounds a recorded turn list by: a longer log is one no
   * replay could carry. Nothing enforces the agreement - same Inbox entry as the bound above.
   */
  maxRecordedTurns: 240,
  /**
   * Characters accepted from the new-hunt seed field before the seed is refused (PLAN M5.5a).
   * The seed is the one number the player types, so it arrives from outside and is bounded
   * before it is parsed; an entry over this is an error result, never a truncation.
   * Ten digits is the whole unsigned 32-bit range the RNG seeds from and keeps every accepted
   * seed inside `Number.MAX_SAFE_INTEGER`, so no second bound on the value is needed.
   */
  maxSeedInputLength: 10,
} as const;
