/**
 * The composition root of `sim` (PLAN M4.2c, and the no-op PLAN M2.4 left for exactly this).
 *
 * Every `create*` call in this workspace lives here - the game and turn logic, PLAN M4.1's bots,
 * PLAN M4.2b's runner, and the map renderer, artefact writer and filesystem sink PLAN M2.4 left
 * wired to nothing. Nothing below this file constructs a collaborator (AGENTS.md "Inversion of
 * control"), and nothing below it names `process` or `console`: the app returns lines and a status,
 * and this is where they become output and an exit code.
 */

import process from "node:process";
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
  createRiverLogic,
  createRng,
  createScoringLogic,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
} from "@manhunter/core";
import { createSimAppLogic } from "./app";
import { createArtifactWriter } from "./artifact";
import { createBotLogic } from "./bots/bots";
import { createRunnerLogic } from "./runner";
import { createFileSink } from "./sink";
import { createMapSvgLogic } from "./svg";

/** `node` and the script path lead `process.argv`; the flags start after them. */
const ARGUMENTS_START = 2;

const FAILURE_EXIT_CODE = 1;

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

const app = createSimAppLogic({
  runner: createRunnerLogic({
    rng,
    game,
    turn,
    bots: createBotLogic({ rng, graph }),
    scoring: createScoringLogic(),
  }),
  game,
  svg: createMapSvgLogic(),
  writer: createArtifactWriter({ sink: createFileSink() }),
});

const outcome = await app.run({
  argv: process.argv.slice(ARGUMENTS_START),
  balance: BALANCE,
});

for (const line of outcome.lines) {
  console.log(line);
}

if (outcome.status === "failed") {
  process.exitCode = FAILURE_EXIT_CODE;
}
