(() => {
  "use strict";

  const AMAZON_KEY = "sanrioAmazonAffiliateReportsV1";
  const AMAZON_PRIMARY_KEY = "sanrioAmazonPrimaryAccountV1";
  const RAKUTEN_KEY = "sanrioRakutenOrderReportsV1";
  const root = document.getElementById("revenueInsights");
  if (!root) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
  const n = value => {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  };
  const yen = value => "¥" + Math.round(n(value)).toLocaleString("ja-JP");
  const count = value => Math.round(n(value)).toLocaleString("ja-JP");
  const pct = value => (n(value) * 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "%";
  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || ""); }
    catch (_) { return fallback; }
  };
  function openPostsDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("sanrioPostHelperDB", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function getPosts() {
    const db = await openPostsDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("popularPosts", "readonly").objectStore("popularPosts").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
  function xRecommendation(posts) {
    const rows = posts.filter(post => {
      const text = String(post.text || "") + " " + String(post.title || "");
      const affiliate = post.amazon || post.rakuten || /(amzn\.|amazon\.|rakuten\.)/i.test(text);
      return post.source === "x-analytics" && affiliate && n(post.impressions) >= 1000 && n(post.urlClicks) > 0;
    }).map(post => ({ ...post, ctr: n(post.urlClicks) / n(post.impressions) }))
      .sort((a, b) => b.ctr - a.ctr || n(b.urlClicks) - n(a.urlClicks));
    if (!rows.length) return null;
    const winner = rows[0];
    const title = String(winner.title || winner.text || "X投稿").replace(/\s+/g, " ").trim();
    return {
      source: "X投稿データ",
      title: title.length > 88 ? title.slice(0, 87) + "…" : title,
      metric: "クリック率 " + pct(winner.ctr) + " ・ 表示 " + count(winner.impressions) + " ・ 対象 " + rows.length + "投稿",
      action: "この投稿の切り口を、次の関連商品の紹介で試す。文面は新しく作り、結果を見比べる。"
    };
  }
  function amazonRecommendation() {
    const reports = readJson(AMAZON_KEY, []);
    if (!Array.isArray(reports) || !reports.length) return null;
    const primary = localStorage.getItem(AMAZON_PRIMARY_KEY) || "";
    const accountReports = reports.filter(report => !primary || report.accountId === primary);
    const report = accountReports.slice().sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")))[0];
    if (!report) return null;
    const products = Array.isArray(report.products) ? report.products : [];
    const top = products.filter(product => n(product.commission) > 0 || n(product.shippedItems) > 0)
      .sort((a, b) => n(b.commission) - n(a.commission) || n(b.shippedItems) - n(a.shippedItems))[0];
    if (top) return {
      source: "Amazon商品別レポート",
      title: String(top.title || top.asin || "商品別上位商品"),
      metric: count(top.shippedItems) + "点発送 ・ 紹介料 " + yen(top.commission) + " ・ " + String(report.start || "期間不明"),
      action: "この商品を含む関連商品の投稿候補にする。単日・短期間の実績なら、次回レポートでも確認する。"
    };
    const seller = (Array.isArray(report.topSellers) ? report.topSellers : []).slice().sort((a, b) => n(a.rank) - n(b.rank))[0];
    if (seller) return {
      source: "Amazon商品ランキング",
      title: String(seller.title || seller.asin || "ランキング上位商品"),
      metric: "ランキング " + count(seller.rank) + "位 ・ " + String(report.start || "期間不明"),
      action: "ランキング上位の参考候補。商品別報酬の裏付けはないため、売上実績としては扱わない。"
    };
    return null;
  }
  function rakutenRecommendation() {
    const reports = readJson(RAKUTEN_KEY, {});
    if (!reports || typeof reports !== "object") return null;
    const rows = Object.values(reports).flatMap(report => Array.isArray(report?.rows) ? report.rows : []);
    if (!rows.length) return null;
    const confirmed = rows.filter(row => n(row.status) === 1 && row.item);
    const provisional = rows.filter(row => n(row.status) === 0 && row.item);
    const selected = confirmed.length ? confirmed : provisional;
    if (!selected.length) return null;
    const products = new Map();
    selected.forEach(row => {
      const key = String(row.shop || "") + "\u0000" + String(row.item || "");
      const product = products.get(key) || { shop: row.shop || "", item: row.item || "", reward: 0, rows: 0 };
      product.reward += n(row.reward);
      product.rows++;
      products.set(key, product);
    });
    const winner = [...products.values()].sort((a, b) => b.reward - a.reward || b.rows - a.rows)[0];
    if (!winner) return null;
    const status = confirmed.length ? "確定" : "未確定";
    return {
      source: "楽天注文別レポート",
      title: String(winner.item),
      metric: status + "報酬 " + yen(winner.reward) + " ・ " + count(winner.rows) + "明細" + (winner.shop ? " ・ " + winner.shop : ""),
      action: confirmed.length
        ? "確定報酬につながった商品。近いジャンルの紹介候補として、次の投稿テーマを考える。"
        : "未確定の参考値。確定後に報酬を確認してから、継続紹介を判断する。"
    };
  }

  let busy = false;
  async function render() {
    if (busy) return;
    busy = true;
    try {
      const posts = await getPosts();
      const ideas = [xRecommendation(posts), amazonRecommendation(), rakutenRecommendation()].filter(Boolean);
      if (!ideas.length) {
        root.innerHTML = '<p class="revenue-insights-empty">候補を出すには、X分析CSVまたはAmazon・楽天レポートをこの端末に読み込んでください。</p>';
        return;
      }
      root.innerHTML = '<div class="revenue-insights-list">' + ideas.slice(0, 3).map((idea, index) =>
        '<article class="revenue-insight"><span class="revenue-insight-source">' + esc(idea.source) + '</span>' +
        '<strong class="revenue-insight-title">' + (index + 1) + '. ' + esc(idea.title) + '</strong>' +
        '<span class="revenue-insight-metric">' + esc(idea.metric) + '</span>' +
        '<p>' + esc(idea.action) + '</p></article>'
      ).join("") + '</div><p class="revenue-insights-note">X投稿と売上レポートは別々に表示しています。対応付けできない売上を、特定の投稿の成果とは判断しません。データはこのブラウザー内だけで集計します。</p>';
    } catch (error) {
      root.innerHTML = '<p class="revenue-insights-empty">改善候補を読み込めませんでした。ページを再読み込みしてください。</p>';
    } finally {
      busy = false;
    }
  }

  const dashboard = document.querySelector(".analytics-dashboard");
  dashboard?.addEventListener("toggle", () => { if (dashboard.open) render(); });
  document.getElementById("refreshRevenueInsights")?.addEventListener("click", render);
  let refreshTimer;
  const scheduleRender = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (dashboard?.open) render(); }, 120);
  };
  ["amazonReportsSummary", "rakutenReportSummary", "analyticsSummary"].forEach(id => {
    const node = document.getElementById(id);
    if (node) new MutationObserver(scheduleRender).observe(node, { childList: true, subtree: true, characterData: true });
  });
  if (dashboard?.open) render();
})();
