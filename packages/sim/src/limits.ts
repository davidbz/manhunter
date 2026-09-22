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
  /**
   * Games one `bun run sim` invocation may simulate (PLAN M4.2).
   *
   * Tuned down from M0.2's placeholder 100_000 on measurement, the way PLAN M2.3 tuned
   * `maxMapGenerationAttempts`. **Time is the only constraint; memory is not.** The runner folds
   * each hunt as it ends and keeps two of them, so a run's heap is flat in the number of games
   * (measured: under 12 MB of heap and a 1.6 KB report for a 1000-game batch, the same for 100).
   * What a batch costs is wall clock: **8 ms a game on the default 8x6 grid at a 24-turn deadline,
   * and 280 ms a game on the widest legal one** (16x16, the 240-turn `maxGameTurns` deadline).
   * At 100_000 those are 13 minutes and **8 hours**; at 10_000 they are 80 seconds and 47
   * minutes. A cap is what a mistyped `--games` runs into, so it is set where the worst legal
   * config still finishes inside an hour, and it leaves an order of magnitude over the largest
   * batch anything in the plan asks for (PLAN M4.3's targets, and M4.2b's 1000-game reference).
   */
  maxGamesPerRun: 10_000,
  /**
   * Bytes a single written artefact may reach before the write is rejected (PLAN M2.4, M4.2c).
   * Kept at the M0.2 placeholder, but no longer for the reason M2.4 gave: it expected M4.2's batch
   * report to be the large artefact, and M4.2b measured that report at about 1.6 KB whatever the
   * batch size, because the fold keeps two hunts and not `maxGamesPerRun` of them. **The largest
   * thing `sim` writes is still M2.4's map SVG, at 14.5 KB for a default 8x6 map**, and the widest
   * legal map (`core`'s `maxMapNodes`, 256 nodes) scales that to well under a megabyte.
   * So this is three orders of magnitude of headroom over the real worst case rather than a bound
   * sized to it, and it stays there deliberately: it is the backstop against a bug that builds an
   * unbounded string, not a budget any artefact is expected to approach.
   */
  maxOutputFileBytes: 16 * 1024 * 1024,
  /**
   * CLI arguments accepted before the invocation is rejected (PLAN M4.2c). Six flags with a value
   * each is twelve arguments, so this is not quite three times what the shipped grammar can use;
   * the headroom is for flags later tasks add, not for repetition.
   */
  maxCliArguments: 32,
  /**
   * Characters a single CLI argument may hold (PLAN M4.2c). `maxCliArguments` bounds how many
   * arguments arrive and this bounds how large one may be, which is what makes argv a bounded
   * input in bytes and not only in count (AGENTS.md section 5). The longest argument the grammar
   * has a use for is `--out`'s directory, so it is sized at the 4096 bytes POSIX `PATH_MAX`
   * allows: a path this side of it may still be rejected by the filesystem, and one past it cannot
   * be a path at all.
   */
  maxCliArgumentLength: 4_096,
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
