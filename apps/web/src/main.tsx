/**
 * The composition root (AGENTS.md "Inversion of control"). Every `create*` call in `apps/web`
 * lives here: the object graph is wired once, the store is handed the logic it dispatches to
 * (PLAN M5.2), and no component constructs anything.
 */

import {
  BALANCE,
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
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createGameStore } from "./gamestore";
import { replayParamOf } from "./sharelinkurl";
import { GameStoreProvider } from "./storecontext";

const MOUNT_ELEMENT_ID = "root";

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

const scoring = createScoringLogic();
const playback = createPlaybackLogic({ game, turn });

const store = createGameStore({ game, turn, scoring, playback }, BALANCE);

/**
 * The share link (PLAN M5.6b-2), read once at load the same way `MOUNT_ELEMENT_ID` is: a shared
 * hunt is a property of the page this build was opened from, not something a component decides
 * to fetch, so it is wired here rather than from inside `App`.
 */
const sharedReplay = replayParamOf(window.location.search);
if (sharedReplay !== null) {
  store.getState().loadShared(sharedReplay);
}

const mount = document.getElementById(MOUNT_ELEMENT_ID);
if (!mount) {
  throw new Error(`index.html is missing the #${MOUNT_ELEMENT_ID} mount point`);
}

createRoot(mount).render(
  <StrictMode>
    <GameStoreProvider store={store}>
      <App />
    </GameStoreProvider>
  </StrictMode>,
);
