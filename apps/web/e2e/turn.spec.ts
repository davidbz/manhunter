/**
 * The turn flow (PLAN M5.5b, rewritten by M7.3): start a hunt, arm a roadblock, click a road, see
 * the row appear, end the turn, and watch the clock move. M7.3 removed the Add button: clicking a
 * road with the tool armed is what places the order, and the tool stays armed for the next one. One of the two flows Playwright keeps (PLAN "Decisions"); everything
 * smaller than a whole flow is a Vitest file.
 *
 * The test ids are repeated here rather than imported. The components that own them are `.tsx`,
 * and `tsconfig.tools.json` - which is what type-checks this directory - has no JSX setting and
 * no React in scope, so importing one to borrow a string would pull the UI into the runner.
 */

import { expect, type Page, test } from "@playwright/test";

const SEED = "7";

const SEED_FIELD = "new-hunt-seed";
const START_BUTTON = "new-hunt-start";
const DISPATCH_SCREEN = "dispatch-screen";
const QUEUE_ROW = "queue-row";
const END_TURN = "end-turn";
const DISPATCH_REFUSAL = "dispatch-refusal";

const CLOCK_METER = '[data-testid="meter"][data-meter="clock"]';
const ROADBLOCK_OPTION = '[data-testid="action-option"][data-action="roadblock"]';
/**
 * A road is blockable (`core`'s edge table), and one neither blocked nor already in the plan is
 * what the armed roadblock takes; the screen marks exactly those `data-selectable`.
 */
const OPEN_ROAD =
  '[data-testid="map-edge"][data-edgekind="road"][data-blocked="false"][data-selectable="true"]';
const EDGE_ID_ATTRIBUTE = "data-edgeid";
const BLOCKED_ATTRIBUTE = "data-blocked";
const IS_BLOCKED = "true";

const edgeById = (page: Page, edgeId: string) =>
  page.locator(`[data-testid="map-edge"][${EDGE_ID_ATTRIBUTE}="${edgeId}"]`);

const TURN_VALUE_ATTRIBUTE = "data-value";
const TURNS_PER_END_TURN = 1;
const ONE_QUEUED_ROW = 1;
const TWO_QUEUED_ROWS = 2;
const SECOND_ROW = 1;
const IS_OPEN = "false";
const NOTHING = 0;

const clockTurn = async (page: Page): Promise<number> => {
  const value = await page.locator(CLOCK_METER).getAttribute(TURN_VALUE_ATTRIBUTE);

  return Number(value);
};

test("a roadblock placed on the map is dispatched and the turn counter advances", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId(SEED_FIELD).fill(SEED);
  await page.getByTestId(START_BUTTON).click();
  await expect(page.getByTestId(DISPATCH_SCREEN)).toBeVisible();

  const before = await clockTurn(page);

  await page.locator(ROADBLOCK_OPTION).click();
  const road = page.locator(OPEN_ROAD).first();
  const roadId = await road.getAttribute(EDGE_ID_ATTRIBUTE);
  // An edge marker is an SVG `<g>` around a `<line>`, so its box can be a pixel tall and
  // Playwright's actionability check reads that as hidden. The event still has to be a real one,
  // so it is dispatched at the element rather than aimed at a point.
  await road.dispatchEvent("click");
  await expect(page.getByTestId(QUEUE_ROW)).toHaveCount(ONE_QUEUED_ROW);

  // The tool is still armed, so a second road takes a second order without re-arming. Clicking
  // that row anywhere, not just on its Remove button, takes it back out again.
  const spare = page.locator(OPEN_ROAD).first();
  const spareId = await spare.getAttribute(EDGE_ID_ATTRIBUTE);
  await spare.dispatchEvent("click");
  await expect(page.getByTestId(QUEUE_ROW)).toHaveCount(TWO_QUEUED_ROWS);
  await page.getByTestId(QUEUE_ROW).nth(SECOND_ROW).click();
  await expect(page.getByTestId(QUEUE_ROW)).toHaveCount(ONE_QUEUED_ROW);

  await page.getByTestId(END_TURN).click();

  await expect(page.locator(CLOCK_METER)).toHaveAttribute(
    TURN_VALUE_ATTRIBUTE,
    String(before + TURNS_PER_END_TURN),
  );
  await expect(page.getByTestId(QUEUE_ROW)).toHaveCount(NOTHING);
  await expect(page.getByTestId(DISPATCH_REFUSAL)).toHaveCount(NOTHING);
  // The queue has to have reached `core`, not just emptied: the road the player kept is shut,
  // and the one taken back out is not.
  await expect(edgeById(page, roadId ?? "")).toHaveAttribute(BLOCKED_ATTRIBUTE, IS_BLOCKED);
  await expect(edgeById(page, spareId ?? "")).toHaveAttribute(BLOCKED_ATTRIBUTE, IS_OPEN);
});
