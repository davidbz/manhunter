import {
  BALANCE,
  createDistrictLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createValidatorLogic,
  type HunterAction,
  type HunterReport,
  makeReportId,
  toHunterView,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_DRAFT_TEST_ID, ActionPanel, actionOptionsOf } from "./actionpanel";
import { placeNamesFor } from "./mapnodes";
import { nodeNameOf } from "./placenames";
import { REPORT_CONTENT_TEST_ID, ReportFeed } from "./reportfeed";
import { QUEUE_ROW_TEST_ID, TurnQueue } from "./turnqueue";

/**
 * PLAN M7.1's acceptance line: on a city the generator produced, the feed row, the ready line and
 * the queue name places, and no raw `n-`/`e-` id reaches the player.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 1;
const RAW_ID = /\b[ne]-/;
const RICH = { actionPoints: 3, budget: 1000 };

const rng = createRng();
const graph = createGraphLogic();
const created = createGameLogic({
  rng,
  generation: createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  }),
}).create({
  setup: { map: { columns: 8, rows: 6, exitCount: 3 }, maxTurns: 24, difficulty: "standard" },
  seed: SEED,
  balance: BALANCE,
});
if (created.kind !== "game") throw new Error(`seed ${SEED} produced no game: ${created.kind}`);

const map = toHunterView(created.world).map;
const names = placeNamesFor(map, SEED, BALANCE.map.nodeSpacing);
const node = map.nodes[0];
const edge = map.edges[0];
if (node === undefined || edge === undefined) throw new Error("the generated city is empty");

const BLOCK: HunterAction = { kind: "roadblock", edgeId: edge.id };
const CANVASS: HunterAction = { kind: "canvass", nodeId: node.id };

const REPORTS: readonly HunterReport[] = [
  {
    id: makeReportId("report-seen"),
    source: "witness",
    observedAtTurn: 1,
    receivedAtTurn: 2,
    content: { kind: "sighting", nodeId: node.id, travelMode: "foot" },
  },
  {
    id: makeReportId("report-unseen"),
    source: "cctv",
    observedAtTurn: 1,
    receivedAtTurn: 2,
    content: { kind: "no_sighting", nodeId: node.id },
  },
];

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (children: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(children);
  });
};

const texts = (testId: string): readonly string[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []).map(
    (element) => element.textContent ?? "",
  );

const noop = (): void => undefined;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("place names on the player's surfaces", () => {
  it("the generated ids are the raw kind this guards against", () => {
    expect(node.id).toMatch(RAW_ID);
    expect(edge.id).toMatch(RAW_ID);
  });

  it("names a report's node in the feed, never its id", async () => {
    await render(<ReportFeed reports={REPORTS} currentTurn={2} placeNames={names} />);

    const rows = texts(REPORT_CONTENT_TEST_ID);
    expect(rows).toHaveLength(REPORTS.length);
    for (const row of rows) {
      expect(row).toContain(nodeNameOf(names, node.id));
      expect(row).not.toMatch(RAW_ID);
    }
  });

  it("names the drafted target on the ready line, never its id", async () => {
    await render(
      <ActionPanel
        options={actionOptionsOf(BALANCE, RICH)}
        armed="roadblock"
        onArm={noop}
        target={{ kind: "edge", edgeId: edge.id }}
        draft={BLOCK}
        placeNames={names}
      />,
    );

    const [line] = texts(ACTION_DRAFT_TEST_ID);
    expect(line).toBeDefined();
    expect(line).not.toMatch(RAW_ID);
  });

  it("names every queued target, never its id", async () => {
    await render(
      <TurnQueue
        queue={[BLOCK, CANVASS]}
        refusal={null}
        onRemove={noop}
        onEndTurn={noop}
        placeNames={names}
        actionPoints={{ planned: 2, available: 3 }}
      />,
    );

    const rows = texts(QUEUE_ROW_TEST_ID);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toMatch(RAW_ID);
  });
});
