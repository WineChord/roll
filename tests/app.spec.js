import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function clearStorage(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await clearStorage(page);
});

test("loads the full snapshot and exposes the core decision controls", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { name: /今天这顿/ })).toBeVisible();
  await expect(page.getByText("453 家店铺")).toBeVisible();
  await expect(page.locator(".shop-card")).toHaveCount(48);
  await expect(page.getByRole("button", { name: "开始 Roll" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "开箱" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
});

test("searches, filters, favorites and blacklists without overlap", async ({
  page,
}) => {
  await page.getByRole("searchbox", { name: "搜索门店" }).fill("烤鸭");
  await expect(page.locator(".shop-card").first()).toBeVisible();
  const firstCard = page.locator(".shop-card").first();
  const firstName = await firstCard.locator(".shop-title button").innerText();
  await firstCard.getByRole("button", { name: "收藏" }).click();
  await expect(page.getByRole("tab", { name: /收藏/ })).toContainText("1");
  await page.reload();
  await expect(page.getByRole("tab", { name: /收藏/ })).toContainText("1");

  await page
    .locator(".shop-card")
    .first()
    .getByRole("button", { name: "加入黑名单" })
    .click();
  await expect(page.getByRole("tab", { name: /黑名单/ })).toContainText("1");
  await expect(page.getByText(firstName, { exact: true })).toHaveCount(0);
});

test("rolls a result and persists it in history", async ({ page }) => {
  await page.getByRole("button", { name: "Roll 一次" }).click();
  await expect(page.locator("#resultPanel")).toBeVisible({ timeout: 6000 });
  await expect(page.locator("#resultTitle")).toContainText(/\S+/);
  await page.getByRole("button", { name: "就这家" }).click();
  await page.getByRole("tab", { name: /记录/ }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText("已确定");
});

test("card mode waits for a card and supports automatic selection", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "翻牌" }).click();
  await page.getByRole("button", { name: "Roll 一次" }).click();
  await expect(page.locator(".pick-card")).toHaveCount(8);
  await page.getByRole("button", { name: "替我选" }).click();
  await expect(page.locator("#resultPanel")).toBeVisible({ timeout: 4000 });
});

test("every animated roll mode reaches a result", async ({ page }) => {
  for (const mode of ["转盘", "抽签", "扭蛋", "老虎机"]) {
    await page.getByRole("tab", { name: mode }).click();
    await page.getByRole("button", { name: "Roll 一次" }).click();
    await expect(page.locator("#resultPanel")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#resultTitle")).toContainText(/\S+/);
  }
});

test("preferences dialog exposes sources and export", async ({ page }) => {
  await page.getByRole("button", { name: "偏好" }).first().click();
  await expect(page.getByRole("heading", { name: "偏好与数据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  await expect(page.locator(".source-table tbody tr")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "导出偏好" })).toBeVisible();
});

test("imports preferences and exports a JSON file", async ({ page }) => {
  const payload = {
    app: "roll-wineandchord",
    version: 1,
    preferences: {
      blacklist: ["shop-001"],
      whitelist: [],
      favorites: [],
      history: [],
      excludeRecent: 0,
    },
  };
  await page.locator("#importInput").setInputFiles({
    name: "roll-preferences.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await expect(page.getByRole("tab", { name: /黑名单/ })).toContainText("1");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出偏好", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^roll-preferences-\d{4}-\d{2}-\d{2}\.json$/);
});

test("resets local preferences through confirmation", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "roll.wineandchord.preferences.v1",
      JSON.stringify({ blacklist: ["shop-001"], favorites: ["shop-002"] })
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "偏好" }).first().click();
  await page.getByRole("button", { name: "重置全部" }).click();
  await page.locator("#confirmDialog").getByRole("button", { name: "重置" }).click();
  await expect(page.locator("#confirmDialog")).not.toBeVisible();
  await expect(page.locator("#blacklistCount")).toHaveText("0");
});

test("inventory exposes screenshot groups and downloadable data", async ({ page }) => {
  await page.goto("/inventory.html");
  await expect(page.getByRole("heading", { name: "逐条核对截图" })).toBeVisible();
  await expect(page.locator(".inventory-table tbody tr")).toHaveCount(120);
  await expect(page.getByRole("link", { name: "CSV" })).toHaveAttribute(
    "href",
    "data/shops.csv"
  );
  await page.getByRole("searchbox", { name: "搜索清单" }).fill("烤鸭");
  await expect(page.locator(".inventory-table tbody tr").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact)
    )
  ).toEqual([]);
});

test("has no serious accessibility violations on the main view", async ({
  page,
}) => {
  const results = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact)
    )
  ).toEqual([]);
});
