const { test, expect } = require("@playwright/test");

test("アーカイブからPinterest用Pin準備を開き、権利・情報確認前の画像出力を止める", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async value => { window.__copiedPinterestText = value; } }
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#f8dce8"/></svg>';
  const post = {
    id: "pinterest-fixture-1",
    source: "x-archive",
    postId: "pinterest-fixture-1",
    title: "シナモロールの新作アイテム",
    text: "シナモロールの新作アイテムが登場。詳細はこちら https://www.amazon.co.jp/dp/B0ABC12345 #サンリオ",
    images: ["data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)],
    savedAt: new Date().toISOString()
  };
  await page.locator("#importBackup").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ items: [post] }))
  });
  await expect(page.locator("#archiveList .archive-item")).toHaveCount(1);
  await page.locator('#archiveList button[data-action="detail"]').click();
  await page.getByRole("button", { name: "Pinterest用Pinを準備" }).click();

  await expect(page.locator("#pinterestPinPanel")).toBeVisible();
  await expect(page.locator("#pinterestPinTitle")).toHaveValue("シナモロールの新作アイテム");
  await expect(page.locator("#pinterestPinLink")).toHaveValue("https://www.amazon.co.jp/dp/B0ABC12345?tag=ononbrothers2-22");
  await page.getByRole("button", { name: "Pin画像を保存" }).click();
  await expect(page.locator("#pinterestPinStatus")).toContainText("写真の利用権");

  await page.locator("#pinterestRightsCheck").check();
  await page.locator("#pinterestFactsCheck").check();
  await page.locator('[data-pinterest-copy="description"]').click();
  await expect.poll(() => page.evaluate(() => window.__copiedPinterestText)).toContain("広告・アフィリエイトリンク");
  await page.locator('[data-pinterest-copy="link"]').click();
  await expect.poll(() => page.evaluate(() => window.__copiedPinterestText)).toBe("https://www.amazon.co.jp/dp/B0ABC12345?tag=ononbrothers2-22");
});
