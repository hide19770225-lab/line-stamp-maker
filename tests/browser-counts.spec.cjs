// Real Chromium smoke test: UI can select every supported sticker count.
// Run with: npx playwright test tests/browser-counts.spec.cjs
const { test, expect } = require("@playwright/test");
for (const count of [8,16,24,32,40]) {
  test(`browser loads and accepts ${count} stickers`, async ({page}) => {
    const errors=[];
    page.on("pageerror", e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:8765/");
    await expect(page.locator("#target-count")).toBeVisible();
    await page.locator("#target-count").selectOption(String(count));
    await expect(page.locator("#target-count")).toHaveValue(String(count));
    await expect(page.locator("#easy-target")).toHaveValue(String(count));
    await expect(page.locator("#file-input")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
