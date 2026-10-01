const { test, expect } = require("@playwright/test");

test("トップから新着商品タブを開き、今日の候補へ戻れる", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response && response.status()).toBe(200);

  const todayTab = page.getByRole("tab", { name: "今日の候補", exact: true });
  const newTab = page.getByRole("tab", { name: "新着商品", exact: true });
  await expect(todayTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#todayHomePanel")).toBeVisible();
  await expect(page.locator("#lovelyPanel")).not.toBeVisible();

  await newTab.click();
  await expect(newTab).toHaveAttribute("aria-selected", "true");
  await expect(todayTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#lovelyPanel")).toBeVisible();
  await expect(page.locator("#lovelyRefresh")).toBeVisible();
  await expect(page.locator("#todayHomePanel")).not.toBeVisible();

  await todayTab.click();
  await expect(todayTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#todayHomePanel")).toBeVisible();
  await expect(page.locator("#lovelyPanel")).not.toBeVisible();
});

test("Amazon商品候補ページがiPhone幅で開き、検索例ボタンが使える", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  const response = await page.goto("amazon-scout.html", { waitUntil: "domcontentloaded" });
  expect(response && response.status()).toBe(200);
  await expect(page).toHaveTitle(/Amazon商品候補づくり/);
  await expect(page.getByRole("heading", { name: "Amazon商品候補づくり" })).toBeVisible();

  await page.getByRole("button", { name: "新商品" }).click();
  await expect(page.locator("#searchQuery")).toHaveValue("サンリオ 新商品 2026");

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
});

test("商品候補を保存し、アフィリエイトID付き紹介リンクを作る", async ({ page }) => {
  await page.goto("amazon-scout.html", { waitUntil: "domcontentloaded" });

  await page.locator("#productTitle").fill("Playwright動作確認用サンプル商品");
  await page.locator("#productUrl").fill("https://www.amazon.co.jp/dp/B0ABC12345");
  await expect(page.locator("#postDraft")).toHaveValue(/Playwright動作確認用サンプル商品/);
  await expect(page.locator("#postDraft")).toHaveValue(/tag=ononbrothers2-22/);

  await page.getByRole("button", { name: "候補を保存" }).click();
  await expect(page.locator("#candidateList")).toContainText("Playwright動作確認用サンプル商品");
  await expect(page.locator("#candidateList a").first()).toHaveAttribute(
    "href",
    "https://www.amazon.co.jp/dp/B0ABC12345?tag=ononbrothers2-22"
  );
  await expect(page.locator("#formStatus")).toContainText("候補をこのブラウザーに保存しました");
});
