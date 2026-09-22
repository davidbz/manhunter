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
import { PALETTE, TYPE_SCALE } from "./theme";

const MOUNT_ELEMENT_ID = "root";
const NO_MARGIN = "0";
const FULL_VIEWPORT_HEIGHT = "100vh";
const DARK_COLOR_SCHEME = "dark";

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
 * DESIGN.md's "Visual direction" ("dark background... monospace report feed") applied once, here,
 * rather than a stylesheet (PLAN M5.7): `apps/web` has no CSS file, and one holding these same
 * values would be a second copy of `theme.ts`'s palette the colour-literal test could not see.
 * `document.body` is outside `#root`, so a React component can never reach it; the composition
 * root already touches the DOM once for `MOUNT_ELEMENT_ID`, and this is the same kind of one-time
 * page chrome. `colorScheme` asks the browser to render native controls (`<button>`, `<input>`,
 * `<select>`, `<meter>`) in their dark variant, so the tactical dispatch look does not stop at
 * the SVG map.
 */
document.documentElement.style.colorScheme = DARK_COLOR_SCHEME;
document.body.style.margin = NO_MARGIN;
document.body.style.minHeight = FULL_VIEWPORT_HEIGHT;
document.body.style.background = PALETTE.background;
document.body.style.color = PALETTE.text;
document.body.style.fontFamily = TYPE_SCALE.fontFamily;
document.body.style.fontSize = TYPE_SCALE.fontSizeBase;

createRoot(mount).render(
  <StrictMode>
    <GameStoreProvider store={store}>
      <App />
    </GameStoreProvider>
  </StrictMode>,
);
