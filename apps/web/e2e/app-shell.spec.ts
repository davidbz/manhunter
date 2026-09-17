import { GAME_TITLE } from "@manhunter/core";
import { expect, test } from "@playwright/test";

test("the app shell loads and shows the game title", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(GAME_TITLE);
  // index.html cannot import from core, so its <title> repeats the constant (PLAN M0.4).
  // This is what keeps the two copies in step.
  await expect(page).toHaveTitle(GAME_TITLE);
});
