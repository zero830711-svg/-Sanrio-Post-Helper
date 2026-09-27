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
      apiVersion: "2811",
      items: [{
        sourceType: "news",
        source: "Google News JP",
        title: "ハローキティのスタンドポーチ紹介",
        summary: "中身が見えて使いやすいスタンドポーチ",
        amazonProducts: [{ title: "HELLO KITTY × BRILMY スタンドポーチ BOOK", asin: "B0ABC12345", url: "https://www.amazon.co.jp/dp/B0ABC12345", feature: "中身が見えて使いやすい仕様です。" }],
        url: "https://example.com/news",
        publishedAt: new Date().toISOString()
      }]
    })
  }));

  await page.goto("amazon-ready-3377.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".idea")).toHaveCount(1);
  await expect(page.locator("input, textarea")).toHaveCount(0);
  await expect(page.locator(".post-preview")).toContainText("HELLO KITTY × BRILMY スタンドポーチ BOOK");
  await expect(page.locator(".post-preview")).toContainText("中身が見えて使いやすい仕様です");
  await expect(page.locator(".post-preview")).toContainText("#サンリオ #pr");
  await expect(page.locator(".post-preview")).toContainText("tag=ononbrothers2-22");

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
  expect(copied).toContain("#サンリオ #pr");
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
      apiVersion: "2811",
      items: [{
        sourceType: "news",
        source: "Google News JP",
        title: "サンリオ新作グッズ情報",
        summary: "新作",
        url: "https://example.com/news",
        amazonProducts: [{ title: "サンリオ商品", asin: "B0ABC12345", url: "https://www.amazon.co.jp/dp/B0ABC12345" }],
        publishedAt: "2025-01-01T00:00:00.000Z"
      }]
    })
  }));

  await page.goto("amazon-ready-3377.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".idea")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("実物商品のAmazonリンク付き候補は見つかりませんでした");
});
