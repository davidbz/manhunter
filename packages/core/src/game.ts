/**
 * Starting a hunt: a player-visible `GameSetup` plus a seed becomes a `SealedWorld` - the world
 * the caller may hold between turns but not read (architecture rule 4, `sealed.ts`).
 *
 * Two of the config's fields are deliberately not the player's to choose. DESIGN.md hides the
 * criminal's profile and starts the hunt "at a random time of day", so both are drawn off the
 * seed here. A replay therefore stores neither, and a shared replay link cannot spoil the hunt
 * it replays.
 *
 * Each draw takes its own forked stream. `fork` derives without advancing the parent (M1.1), so
 * the profile, the start hour, the map and the play stream are four independent streams off one
 * seed, and adding a fifth later cannot shift the other four.
 */

import type { Balance } from "./balance";
import type { Difficulty, GameConfig, GameSetup } from "./config";
import { type CriminalProfile, type CriminalState, makeCriminalState } from "./criminal";
import type { AttemptFailure, GenerationLogic } from "./generate";
import { type HunterState, makeHunterState } from "./hunter";
import type { NodeId } from "./ids";
import { LIMITS } from "./limits";
import type { TravelMode } from "./map";
import type { Rng, RngState } from "./rng";
import { type SealedWorld, seal } from "./sealed";
import { HOURS_PER_DAY, type Hour, makeClock, type Turn } from "./time";
import { makeWorldState } from "./world";

export type GameRequest = {
  readonly setup: GameSetup;
  readonly seed: number;
  readonly balance: Balance;
};

/**
 * Why a hunt could not start. `deadline_too_long` is the bound on the one untrusted number in
 * `GameSetup` that no other task already covers - the grid is bounded by `LIMITS.maxMapNodes`
 * inside generation - and `generation_failed` is M2.3's answer passed through with its numbers
 * intact, because "this config can never carry a river" and "this seed was unlucky" are different
 * answers and the caller has to tell them apart.
 */
export type GameResult =
  | { readonly kind: "game"; readonly world: SealedWorld }
  | {
      readonly kind: "deadline_too_long";
      readonly requestedTurns: Turn;
      readonly maxTurns: Turn;
    }
  | {
      readonly kind: "generation_failed";
      readonly attempts: number;
      readonly lastFailure: AttemptFailure;
    };

export type GameLogic = {
  readonly create: (request: GameRequest) => GameResult;
};

type GameDeps = {
  readonly rng: Rng;
  readonly generation: GenerationLogic;
};

/**
 * Fork labels. Code-authored constants, never user input, so no bound is declared on them
 * (M1.1). Changing one re-rolls every hunt, which is what invalidates a shared replay.
 */
const STREAM = {
  profile: "criminal-profile",
  startHour: "start-hour",
  map: "map",
  play: "play",
} as const;

/** The criminal's only MVP mode, and what `minEscapeTurns` is measured in (PLAN "Decisions"). */
const START_MODE: TravelMode = "foot";

const FIRST_TURN: Turn = 0;
const FIRST_HOUR: Hour = 0;

const drawProfile = (
  rng: Rng,
  balance: Balance,
  difficulty: Difficulty,
  root: RngState,
): CriminalProfile =>
  rng.weightedPick(rng.fork(root, STREAM.profile), balance.criminal.pools[difficulty]).value;

const drawStartHour = (rng: Rng, root: RngState): Hour =>
  rng.int(rng.fork(root, STREAM.startHour), FIRST_HOUR, HOURS_PER_DAY).value;

const startingHunter = (balance: Balance): HunterState =>
  makeHunterState({
    actionPoints: balance.hunter.actionPointsPerTurn,
    budget: balance.hunter.startingBudget,
    trust: balance.hunter.startingTrust,
    pressure: balance.hunter.startingPressure,
  });

/** The criminal begins at the crime scene, which is the one place both sides already know. */
const startingCriminal = (
  balance: Balance,
  profile: CriminalProfile,
  nodeId: NodeId,
): CriminalState =>
  makeCriminalState({
    nodeId,
    travelMode: START_MODE,
    profile,
    stamina: balance.criminal.startingStamina,
    heat: balance.criminal.startingHeat,
    cash: balance.criminal.startingCash,
    desperation: balance.criminal.startingDesperation,
  });

export const createGameLogic = ({ rng, generation }: GameDeps): GameLogic => ({
  create: ({ setup, seed, balance }) => {
    if (setup.maxTurns > LIMITS.maxGameTurns) {
      return {
        kind: "deadline_too_long",
        requestedTurns: setup.maxTurns,
        maxTurns: LIMITS.maxGameTurns,
      };
    }

    const root = rng.seed(seed);
    const generated = generation.generate({
      config: setup.map,
      balance,
      state: rng.fork(root, STREAM.map),
    });
    if (generated.kind !== "map") {
      return {
        kind: "generation_failed",
        attempts: generated.attempts,
        lastFailure: generated.lastFailure,
      };
    }

    const config: GameConfig = {
      criminalProfile: drawProfile(rng, balance, setup.difficulty, root),
      startHour: drawStartHour(rng, root),
      maxTurns: setup.maxTurns,
      map: setup.map,
      difficulty: setup.difficulty,
    };

    return {
      kind: "game",
      world: seal(
        makeWorldState({
          config,
          rng: rng.fork(root, STREAM.play),
          clock: makeClock(config.startHour, FIRST_TURN),
          map: generated.graph,
          hunter: startingHunter(balance),
          criminal: startingCriminal(
            balance,
            config.criminalProfile,
            generated.graph.incidentNodeId,
          ),
        }),
      ),
    };
  },
});
