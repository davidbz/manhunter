/**
 * The object graph `main.tsx` wires, for tests (PLAN M5.5a, resolving the Inbox entry about the
 * composition-root block duplicated across every panel test).
 *
 * It is not a second composition root: nothing in the production graph imports it. It sits
 * outside the Vitest `include` glob deliberately, so it is a fixture rather than a suite, and it
 * carries no data of its own - no setup, no seed - because those differ per test and belong
 * beside the assertions that read them.
 *
 * A test that needs a fake still wires the same factories itself, the way `gamestore.test.ts`
 * does with its echoing `TurnLogic`. This is only for the tests that want the shipped engine.
 */

import {
  createActionLogic,
  createBeliefLogic,
  createCriminalAiLogic,
  createDistrictLogic,
  createEventLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createIntelLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
} from "@manhunter/core";
import type { GameStoreDeps } from "./gamestore";

const rng = createRng();
const graph = createGraphLogic();

export const TEST_GAME_DEPS: GameStoreDeps = {
  game: createGameLogic({
    rng,
    generation: createGenerationLogic({
      rng,
      topology: createTopologyLogic({ rng, graph }),
      river: createRiverLogic({ rng, graph }),
      districts: createDistrictLogic({ rng, graph }),
      validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
    }),
  }),
  turn: createTurnLogic({
    rng,
    intel: createIntelLogic({ rng, graph }),
    events: createEventLogic({ rng }),
    belief: createBeliefLogic({ graph }),
    action: createActionLogic({ rng }),
    ai: createCriminalAiLogic({ rng, graph }),
    graph,
  }),
};
