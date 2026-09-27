const { test, expect } = require("@playwright/test");

test("話題から完成した投稿文と紹介リンクを自動生成し、コピーできる", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sanrioCloudSyncKey", "test-sync-key");
  });
  await page.route("**/trend.php*", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      items: [{
        sourceType: "news",
        source: "Google News JP",
        title: "サンリオ新作ぬいぐるみが発売",
        summary: "新作グッズ情報",
        url: "https://example.com/news",
        publishedAt: new Date().toISOString()
      }]
    })
  }));

  await page.goto("amazon-ready.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".idea")).toHaveCount(1);
  await expect(page.locator("input, textarea")).toHaveCount(0);
  await expect(page.locator(".preview")).toContainText("【PR】");
  await expect(page.locator(".preview")).toContainText("tag=ononbrothers2-22");
  await expect(page.locator(".preview")).toContainText("サンリオ新作ぬいぐるみが発売");

  await page.evaluate(() => {
    window.__copiedPost = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async value => { window.__copiedPost = value; } }
    });
  });
  await page.getByRole("button", { name: "投稿文をコピー" }).click();
  await expect(page.getByRole("button", { name: "コピーしました" })).toBeVisible();
  const copied = await page.evaluate(() => window.__copiedPost);
  expect(copied).toContain("#PR");
  expect(copied).toContain("tag=ononbrothers2-22");
});

test("古い話題からは投稿案を作らない", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sanrioCloudSyncKey", "test-sync-key");
  });
  await page.route("**/trend.php*", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      items: [{
        sourceType: "news",
        source: "Google News JP",
        title: "サンリオ新作グッズ情報",
        summary: "新作",
        url: "https://example.com/news",
        publishedAt: "2026-01-01T00:00:00.000Z"
      }]
    })
  }));

  await page.goto("amazon-ready.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".idea")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("今回は候補を表示していません");
});
