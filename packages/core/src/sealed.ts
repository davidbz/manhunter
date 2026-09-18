/**
 * Sealing the world (architecture rule 4).
 *
 * `SealedWorld` is what a caller outside `core` holds between turns: the same value as a
 * `WorldState`, behind a brand key `core` does not export. `apps/web` can store one and hand it
 * back to a game function; it cannot read a member off one, and it cannot pass a `WorldState` it
 * built itself off as one either.
 *
 * Every exported game function takes and returns the sealed form, so there is one signature
 * rather than two. `seal` stays inside `core`. `unseal` is exported because `sim` is a balance
 * tool with no hidden-information concern and would otherwise hold a world it could not step;
 * `biome.json` denies it to `apps/web` by name.
 *
 * The seal is a type-level guarantee, not encryption: the world's own bytes have to survive
 * `JSON.stringify` for replays to work (AGENTS.md rule 4), so both conversions are assertions
 * over one value rather than a wrapper that a round-trip would lose.
 */

import type { WorldState } from "./world";

declare const SEAL: unique symbol;

export type SealedWorld = {
  readonly [SEAL]: "world";
};

export const seal = (world: WorldState): SealedWorld => world as unknown as SealedWorld;

export const unseal = (world: SealedWorld): WorldState => world as unknown as WorldState;
