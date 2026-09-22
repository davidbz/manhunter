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
import { cssVariablesOf } from "./cssvariables";
import { createGameStore } from "./gamestore";
import { replayParamOf } from "./sharelinkurl";
import { GameStoreProvider } from "./storecontext";
import { DESIGN_TOKENS } from "./theme";

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

/**
 * The design tokens, published to the document element so `index.css` can read them (PLAN M6.1).
 * This is the one direction the values are allowed to travel: `theme.ts` is the single source, the
 * stylesheet holds no literal of its own, and the colour-literal test can therefore still see
 * every colour `apps/web` draws with. M5.7 applied the page chrome as `document.body.style.*`
 * assignments precisely because there was no stylesheet to read a variable from; the rules those
 * assignments stood in for now live in `index.css`, which is where `:focus-visible`,
 * `@keyframes` and `prefers-reduced-motion` can reach them and an inline style object cannot.
 *
 * `document.documentElement` is outside `#root`, so a React component can never reach it, and the
 * composition root already touches the DOM once for `MOUNT_ELEMENT_ID`.
 */
const root = document.documentElement;
for (const [name, value] of Object.entries(cssVariablesOf(DESIGN_TOKENS))) {
  root.style.setProperty(name, value);
}

createRoot(mount).render(
  <StrictMode>
    <GameStoreProvider store={store}>
      <App />
    </GameStoreProvider>
  </StrictMode>,
);
