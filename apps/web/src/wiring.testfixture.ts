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
  createPlaybackLogic,
  createRiverLogic,
  createRng,
  createScoringLogic,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
} from "@manhunter/core";
import { type ClipboardLogic, createClipboardLogic } from "./clipboard";
import type { GameStoreDeps } from "./gamestore";

const rng = createRng();
const graph = createGraphLogic();

const game = createGameLogic({
  rng,
  generation: createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  }),
});

const turn = createTurnLogic({
  rng,
  intel: createIntelLogic({ rng, graph }),
  events: createEventLogic({ rng }),
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng }),
  ai: createCriminalAiLogic({ rng, graph }),
  graph,
});

export const TEST_GAME_DEPS: GameStoreDeps = {
  game,
  turn,
  scoring: createScoringLogic(),
  playback: createPlaybackLogic({ game, turn }),
};

/**
 * A clipboard for tests that render the share link but do not copy it (PLAN M6.9): the page has
 * no Clipboard API and its timer never fires, so a stray click is a visible `unavailable` rather
 * than a write that leaves the test.
 */
export const TEST_CLIPBOARD: ClipboardLogic = createClipboardLogic({
  writer: null,
  wait: () => new Promise<void>(() => undefined),
});
