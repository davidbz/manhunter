/**
 * Bounds for every boundary `sim` crosses, per AGENTS.md "Bound every I/O up front":
 * CLI arguments in, report and map files out. Each boundary gets a test that feeds it
 * input one over the limit when the boundary itself is implemented.
 */
export const LIMITS = {
  /** Games one `bun run sim` invocation may simulate (PLAN M4.2). */
  maxGamesPerRun: 100_000,
  /**
   * Bytes a single written artefact may reach before the write is rejected (PLAN M2.4, M4.2).
   * Kept at the M0.2 placeholder deliberately: M2.4 implemented the boundary and measured its own
   * artefact at 14.5 KB for a default 8x6 map, three orders of magnitude inside this, so the bound
   * is really sized for M4.2's batch report over up to `maxGamesPerRun` games. Tuning it down to
   * map scale would only move the failure into the task that has the larger artefact.
   */
  maxOutputFileBytes: 16 * 1024 * 1024,
  /** CLI arguments accepted before the invocation is rejected (PLAN M4.2). */
  maxCliArguments: 32,
} as const;
