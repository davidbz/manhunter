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
