/**
 * Finishing a hunt (PLAN M5.6a): start it, let it run to a real ending, and see the outcome and
 * the score breakdown. The second and last of the two flows Playwright keeps (PLAN "Decisions");
 * every score component is a jsdom assertion instead (`endscreen.test.tsx`), which is where the
 * AC's exhaustiveness check belongs - cheap and run on every component, not once per browser turn.
 *
 * The test ids are repeated here rather than imported, for the reason `turn.spec.ts` gives:
 * `tsconfig.tools.json`, which type-checks this directory, has no JSX setting.
 *
 * Seed 1 (the form's own default) escapes on turn 4 under the balance's default setup with no
 * hunter action taken at all - measured directly against `createGameLogic`/`createTurnLogic`
 * rather than assumed, the same way `turn.spec.ts`'s seed 7 was picked. `TURNS_TO_PLAY` gives it
 * headroom rather than hard-coding the exact figure, so a balance retune that moves the escape by
 * a turn does not break this spec.
 */

import { expect, type Page, test } from "@playwright/test";

const SEED = "1";

const SEED_FIELD = "new-hunt-seed";
const START_BUTTON = "new-hunt-start";
const DISPATCH_SCREEN = "dispatch-screen";
const END_TURN = "end-turn";
const END_SCREEN = "end-screen";
const END_SCREEN_OUTCOME = "end-screen-outcome";
const SCORE_COMPONENT = "score-component";

const TURNS_TO_PLAY = 8;
const AT_LEAST_ONE_COMPONENT = 1;

const endScreenShown = (page: Page) => page.getByTestId(END_SCREEN);

test("finishing a seeded hunt shows the outcome and the score breakdown", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId(SEED_FIELD).fill(SEED);
  await page.getByTestId(START_BUTTON).click();
  await expect(page.getByTestId(DISPATCH_SCREEN)).toBeVisible();

  for (let played = 0; played < TURNS_TO_PLAY; played += 1) {
    if (await endScreenShown(page).count()) break;
    await page.getByTestId(END_TURN).click();
  }

  await expect(endScreenShown(page)).toBeVisible();
  await expect(page.getByTestId(END_SCREEN_OUTCOME)).toHaveAttribute("data-outcome", "escaped");
  const componentCount = await page.getByTestId(SCORE_COMPONENT).count();
  expect(componentCount).toBeGreaterThanOrEqual(AT_LEAST_ONE_COMPONENT);
});
