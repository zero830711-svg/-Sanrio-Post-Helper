const { test, expect } = require("@playwright/test");

test("再投稿後の分析CSVを高一致度で照合し、元投稿と率を比較する", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const original = {
      id: "xanalytics-original-10001",
      source: "x-analytics",
      postId: "10001",
      title: "サンプル投稿",
      text: "ハローキティの新作マスコットが登場。小さくてかわいいデザインをチェックしてね🎀 #サンリオ",
      xUrl: "https://x.com/user/status/10001",
      postedAt: new Date(now - 60 * 86400000).toISOString(),
      savedAt: new Date(now - 60 * 86400000).toISOString(),
      impressions: "10000",
      urlClicks: "200",
      bookmarks: "50",
      likes: "400",
      reposts: "30"
    };
    await dbPut(original);
    await applyReposted(original);

    const postedAt = new Date(Date.now() + 60_000).toISOString();
    const csv = [
      "ポストID,日付,ポスト本文,ポストのリンク,インプレッション数,いいね,ブックマーク,リポスト,返信,URLのクリック数,新しいフォロー",
      '20002,"' + postedAt + '","ハローキティの新作マスコットが登場。小さくてかわいいデザインをチェックしてね🎀 #サンリオ",https://x.com/user/status/20002,5000,250,40,20,2,150,3'
    ].join("\n");
    const imported = await importAnalyticsCSV(new File([csv], "analytics.csv", { type: "text/csv" }));
    await renderRecentUsed();
    const stored = (await dbGetAll()).find(item => item.postId === "10001");
    return { imported, stored };
  });

  expect(result.imported.repostMatches).toBe(1);
  expect(result.stored.repostAttempts[0].matchedPostId).toBe("20002");
  expect(result.stored.repostAttempts[0].snapshot.urlClicks).toBe(150);
  await expect(page.locator("#recentUsedList")).toContainText("再投稿の成績（参考）");
  await expect(page.locator("#recentUsedList")).toContainText("クリック率：元 2.00% → 再 3.00%");
  await expect(page.locator("#recentUsedList")).toContainText("保存率：元 0.50% → 再 0.80%");
});

test("本文が短すぎる投稿は照合せず、誤った比較を作らない", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const original = {
      id: "xanalytics-short-30001",
      source: "x-analytics",
      postId: "30001",
      title: "短文投稿",
      text: "新作はこちら #サンリオ",
      postedAt: new Date(now - 40 * 86400000).toISOString(),
      savedAt: new Date(now - 40 * 86400000).toISOString(),
      impressions: "1000",
      urlClicks: "15",
      bookmarks: "20"
    };
    await dbPut(original);
    await applyReposted(original);
    const csv = [
      "ポストID,日付,ポスト本文,ポストのリンク,インプレッション数,いいね,ブックマーク,リポスト,返信,URLのクリック数,新しいフォロー",
      '40002,"' + new Date(Date.now() + 60000).toISOString() + '","新作はこちら #サンリオ",https://x.com/user/status/40002,800,20,10,1,0,8,0'
    ].join("\n");
    const imported = await importAnalyticsCSV(new File([csv], "analytics.csv", { type: "text/csv" }));
    const stored = (await dbGetAll()).find(item => item.postId === "30001");
    return { imported, stored };
  });

  expect(result.imported.repostMatches).toBe(0);
  expect(result.stored.repostAttempts[0].matchedPostId).toBe("");
  expect(result.stored.repostAttempts[0].snapshot).toBeNull();
});

test("同じ本文の候補が複数ある場合は自動で結び付けない", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const text = "ハローキティの新作マスコットが登場。小さくてかわいいデザインをチェックしてね🎀 #サンリオ";
    const first = { id: "xanalytics-50001", source: "x-analytics", postId: "50001", title: "候補1", text, postedAt: new Date(now - 50 * 86400000).toISOString(), savedAt: new Date(now - 50 * 86400000).toISOString(), impressions: "1000", urlClicks: "20", bookmarks: "10" };
    const second = { ...first, id: "xanalytics-50002", postId: "50002", title: "候補2" };
    await dbPut(first);
    await dbPut(second);
    await applyReposted(first);
    await applyReposted(second);
    const csv = [
      "ポストID,日付,ポスト本文,ポストのリンク,インプレッション数,いいね,ブックマーク,リポスト,返信,URLのクリック数,新しいフォロー",
      '60003,"' + new Date(Date.now() + 60000).toISOString() + '","' + text + '",https://x.com/user/status/60003,800,20,10,1,0,8,0'
    ].join("\n");
    const imported = await importAnalyticsCSV(new File([csv], "analytics.csv", { type: "text/csv" }));
    const stored = (await dbGetAll()).filter(item => ["50001", "50002"].includes(item.postId));
    return { imported, stored };
  });

  expect(result.imported.repostMatches).toBe(0);
  expect(result.stored.every(item => item.repostAttempts[0].matchedPostId === "")).toBe(true);
});
