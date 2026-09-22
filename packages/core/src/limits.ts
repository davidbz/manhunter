/**
 * Bounds for loops whose iteration count depends on generated data, per AGENTS.md
 * "Bound every I/O up front". `core` performs no I/O; these cap the internal searches that
 * could otherwise run unbounded on an unlucky seed. Tuning belongs to the task that adds
 * the loop, not here.
 */
export const LIMITS = {
  /**
   * Map regeneration attempts before generate-until-valid gives up (PLAN M2.3). Tuned from the
   * placeholder 64 on measurement: 3000 default-grid seeds need a mean of 5.98 attempts (p99 25,
   * p999 38, max 57), so 64 leaves only a factor of ~1.1 over the observed tail. The geometric
   * rate that implies puts a spurious failure at 8.4e-6 per map, which is a 0.8% chance per
   * 1000-game M4.2 batch - a real flake for M4.3 to chase. 128 puts it at 7e-11 instead.
   * The headroom is close to free: the cap is only ever reached by a config that cannot work,
   * and an impossible one (a 3x3 grid, which can carry no river) exhausts all 128 in under 2ms.
   */
  maxMapGenerationAttempts: 128,
  /**
   * Nodes a generated map may contain (PLAN M2.1a). `MapConfig` comes from the player-visible
   * setup and therefore from a replay string, so the grid is sized from untrusted input and the
   * bound belongs here rather than in `balance.ts`. It is a time bound: generation runs one
   * connectivity sweep per removal candidate, so the work grows with the cube of the grid side,
   * and 256 keeps the default 8x6 two and a half orders of magnitude inside it.
   */
  maxMapNodes: 256,
  /**
   * Nodes a single pathfinding or min-cut search may expand (PLAN M1.4). Tuned down from 100_000
   * when M1.4a chose a scanned frontier over a heap: city maps are tens of nodes, so this is two
   * orders of magnitude of headroom, and it keeps the quadratic worst case well under a second.
   * A search that reaches it is a generator bug, not a workload.
   */
  maxSearchExpansions: 5_000,
  /**
   * Bridge and tunnel edges the chokepoint rule may test (PLAN M2.2). Each candidate costs a whole
   * shortest-path search with that edge removed, so this is a time bound on validation rather than
   * a statement about maps. A generated map carries at most `balance.map.maxBridges` of them and
   * no tunnels at all, so this is an order of magnitude of headroom; a map that reaches it leaves
   * the rule undecided rather than letting a partial scan claim the chokepoint is absent.
   */
  maxChokepointCandidates: 64,
  /**
   * Turns a single hunt may last (PLAN M3.1a). `GameSetup.maxTurns` is the deadline the player
   * asks for, so like the grid size it arrives from a replay string and is untrusted input; a
   * setup over this is rejected rather than clamped. It is a time bound on every loop that runs
   * once per turn - `sim`'s batch runner and M3.9's replay both do - and 240 is ten times
   * `balance.time.maxTurns`, which is room to experiment without room to hang.
   */
  maxGameTurns: 240,
  /** Candidate actions the criminal AI may enumerate in one turn (PLAN M3.5). */
  maxAiCandidates: 256,
  /**
   * Turns of the criminal's own position `CriminalState.trail` keeps (PLAN M3.8b-2). The trail
   * exists so a camera can show footage of the past, so the bound has to cover the deepest
   * `balance.actions.pullCctv.lookbackTurns` a sweep (PLAN M4.3) would set - `balance.test.ts`
   * asserts the current one fits. Four times it, because the trail is state every world carries
   * into a replay string (PLAN M3.9) and a hunt-long history would be paid for on every turn of
   * every game to answer a question two turns deep.
   */
  maxCriminalTrail: 8,
  /**
   * Hunter actions one turn's queue may hold (PLAN M3.8b-1). The queue is handed to `step` by the
   * caller and reaches `core` from a replay string (PLAN M3.9), so like the grid and the deadline
   * it is untrusted input: a longer queue is refused before the turn runs, never truncated.
   * `balance.hunter.actionPointsPerTurn` is 3 and no action costs less than a point, so three is
   * what a turn can actually spend; 32 leaves an order of magnitude for a UI that queues actions
   * it expects to be refused and for M4.3 to raise the allowance without touching this file.
   */
  maxQueuedActions: 32,
  /**
   * Characters a replay string may hold, in either direction (PLAN M3.9). The one size bound in
   * this file: a replay arrives as text from a URL or a paste, and `decodeReplay` checks its
   * length before it splits anything, so every allocation the parse makes is capped by this.
   * Measured rather than guessed: 500 hunts on the default 8x6 grid at the default 24-turn
   * deadline, with the three actions a turn can afford, encode to a mean of 131 characters
   * (p50 125, max 466), and the same hunts on a 16x16 grid to a mean of 267 (max 497).
   * The bound is set from the worst hunt that can legitimately exist instead: the deadline cap
   * of `maxGameTurns` turns, on the largest grid `maxMapNodes` allows, with every turn's action
   * points spent on the longest ids that grid can produce, is 7946 characters. 8192 clears that
   * with room. `LIMITS` is exported from `@manhunter/core` (PLAN M5.6b-2) and `apps/web/src/
   * limits.ts` reads this field rather than carrying its own copy, so the two boundaries this
   * bounds - a hostile URL in `web`, a malformed replay here - cannot drift apart and turn a
   * share link one side accepts into one the other refuses.
   * It is not a bound on queue length: 240 turns of 32 actions is 84506 characters and is
   * refused, which is correct - `maxQueuedActions` is an order of magnitude over what a turn can
   * spend, so such a hunt cannot be played, only fabricated.
   */
  maxReplayStringLength: 8_192,
} as const;
