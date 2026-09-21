/**
 * Bounds for every boundary `sim` crosses, per AGENTS.md "Bound every I/O up front":
 * CLI arguments in, report and map files out. Each boundary gets a test that feeds it
 * input one over the limit when the boundary itself is implemented.
 *
 * The same section's last rule puts the internal enumeration caps here too: a loop whose length
 * comes from generated data is bounded by a named constant even when nothing crosses a boundary.
 * The bot caps below are those.
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
  /**
   * Candidate actions a scripted bot may enumerate for one decision (PLAN M4.1), the counterpart
   * of `core`'s `maxAiCandidates` on the hunter's side. A bot enumerates over a map that came out
   * of a generator, so the count is generated data: the widest legal map is `maxMapNodes` (256)
   * nodes, which is 512 node-targeted candidates plus one roadblock per blockable edge, and 2048
   * clears that with room while keeping the default 8x6 grid (about 160 candidates) an order of
   * magnitude inside it. Reaching it means a map no generator can produce, so the surplus is
   * dropped rather than refused - `core`'s AI does the same with its own cap.
   */
  maxBotCandidates: 2048,
  /**
   * Actions a bot may queue for one turn (PLAN M4.1). `balance.hunter.actionPointsPerTurn` is 3
   * and no shipped action costs less than a point, so three is what a turn can actually spend;
   * this is the bound that keeps the queue loop finite if a balance sweep (PLAN M4.3) ever makes
   * an action free. It must stay at or under `core`'s `LIMITS.maxQueuedActions` (32), which is
   * what `step` refuses a queue against - `core` does not export `LIMITS`, so the two are kept in
   * step by comment, as `maxReplayStringLength` and `apps/web`'s copy of it already are.
   */
  maxBotQueue: 8,
} as const;
