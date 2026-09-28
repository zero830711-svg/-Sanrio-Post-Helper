const { test, expect } = require("@playwright/test");

const postText = "ハローキティの新作マスコットが登場。小さくてかわいいデザインをチェックしてね🎀 #サンリオ";

async function importBackup(page, items) {
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#importBackup").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ items }))
  });
  await expect(page.locator("#archiveList .archive-item")).toHaveCount(items.length);
}

async function markReposted(page, count = 1) {
  for (let i = 0; i < count; i++) {
    await page.locator('#archiveList button[data-action="reposted"]').first().click();
  }
  await expect(page.locator("#recentUsedCard")).toBeVisible();
}

async function importAnalytics(page, row) {
  const header = "ポストID,日付,ポスト本文,ポストのリンク,インプレッション数,いいね,ブックマーク,リポスト,返信,URLのクリック数,新しいフォロー";
  const csv = `${header}\n${row}`;
  await page.locator("#importAnalyticsCsv").setInputFiles({
    name: "analytics.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  });
  await expect(page.locator("#analyticsImportStatus")).toContainText("再投稿との照合");
}

function original(postId, title = "サンプル投稿", text = postText) {
  const postedAt = new Date(Date.now() - 60 * 86400000).toISOString();
  return {
    id: `xanalytics-${postId}`,
    source: "x-analytics",
    postId,
    title,
    text,
    xUrl: `https://x.com/user/status/${postId}`,
    postedAt,
    savedAt: postedAt,
    impressions: "10000",
    urlClicks: "200",
    bookmarks: "50",
    likes: "400",
    reposts: "30"
  };
}

test("再投稿後の分析CSVを高一致度で照合し、元投稿と率を比較する", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await importBackup(page, [original("10001")]);
  await markReposted(page);

  const postedAt = new Date(Date.now() + 60_000).toISOString();
  await importAnalytics(page, `20002,"${postedAt}","${postText}",https://x.com/user/status/20002,5000,250,40,20,2,150,3`);

  await expect(page.locator("#analyticsImportStatus")).toContainText("照合 1件");
  await expect(page.locator("#recentUsedList")).toContainText("再投稿の成績（参考）");
  await expect(page.locator("#recentUsedList")).toContainText("クリック率：元 2.00% → 再 3.00%");
  await expect(page.locator("#recentUsedList")).toContainText("保存率：元 0.50% → 再 0.80%");
});

test("本文が短すぎる投稿は照合せず、誤った比較を作らない", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await importBackup(page, [original("30001", "短文投稿", "新作はこちら #サンリオ")]);
  await markReposted(page);

  const postedAt = new Date(Date.now() + 60_000).toISOString();
  await importAnalytics(page, `40002,"${postedAt}","新作はこちら #サンリオ",https://x.com/user/status/40002,800,20,10,1,0,8,0`);

  await expect(page.locator("#analyticsImportStatus")).toContainText("照合 0件");
  await expect(page.locator("#recentUsedList")).toContainText("再投稿後のX分析データを待っています");
});

test("同じ本文の候補が複数ある場合は自動で結び付けない", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await importBackup(page, [original("50001", "候補1"), original("50002", "候補2")]);
  await markReposted(page, 2);

  const postedAt = new Date(Date.now() + 60_000).toISOString();
  await importAnalytics(page, `60003,"${postedAt}","${postText}",https://x.com/user/status/60003,800,20,10,1,0,8,0`);

  await expect(page.locator("#analyticsImportStatus")).toContainText("照合 0件");
  await expect(page.locator("#recentUsedList").getByText("再投稿後のX分析データを待っています")).toHaveCount(2);
});
