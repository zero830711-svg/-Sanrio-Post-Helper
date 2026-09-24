(() => {
  const STORE_KEY = "sanrioAmazonAffiliateReportsV1";
  const card = document.getElementById("amazonReportsCard");
  if (!card) return;

  const input = document.getElementById("importAmazonReports");
  const status = document.getElementById("amazonReportsStatus");
  const summary = document.getElementById("amazonReportsSummary");
  const clearButton = document.getElementById("clearAmazonReports");
  let zipPromise;

  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
  const money = value => "¥" + Math.round(Number(value) || 0).toLocaleString("ja-JP");
  const number = value => Math.round(Number(value) || 0).toLocaleString("ja-JP");

  function loadReports() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === "\"" && text[i + 1] === "\"") { field += "\""; i++; }
        else if (c === "\"") quoted = false;
        else field += c;
      } else if (c === "\"") quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => String(cell).trim() !== ""));
  }

  function numeric(v) {
    const cleaned = String(v ?? "").replace(/[¥￥,\s]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "—") return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function dateIso(value) {
    const m = String(value || "").match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return "";
    return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  }
  function col(header, candidates) {
    for (const name of candidates) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  }
  async function loadZipLibrary() {
    if (window.JSZip) return window.JSZip;
    if (!zipPromise) {
      zipPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
        script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("ZIPライブラリを読み込めませんでした"));
        script.onerror = () => reject(new Error("ZIP処理の読み込みに失敗しました。通信後にもう一度お試しください"));
        document.head.appendChild(script);
      });
    }
    return zipPromise;
  }

  function accountFromName(name) {
    const match = String(name).match(/-(\d{6})\.zip$/i);
    return match ? match[1] : "";
  }
  function blankReport(accountId, start, end, reportId) {
    return {
      key: accountId + "|" + reportId,
      accountId, start, end, reportId,
      clicks: 0, orderedItems: 0, orderedSales: 0, shippedItems: 0,
      shippedSales: 0, commission: 0, returns: 0, trackingIds: [],
      products: [], categories: [], topSellers: [], sourceTypes: [], importedAt: new Date().toISOString()
    };
  }

  async function readArchive(file, JSZip) {
    const accountId = accountFromName(file.name);
    if (!accountId) throw new Error(file.name + "：末尾6桁のアカウント番号を判別できません");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const csvFiles = Object.values(zip.files).filter(f => !f.dir && /\.csv$/i.test(f.name));
    if (!csvFiles.length) throw new Error(file.name + "：ZIP内にCSVがありません");
    const parsed = [];
    for (const entry of csvFiles) {
      const text = (await entry.async("string")).replace(/^\uFEFF/, "");
      const rows = parseCsv(text);
      if (rows.length < 2) continue;
      parsed.push({name: entry.name, rows});
    }
    const daySet = new Set();
    for (const item of parsed) {
      const h = item.rows[0];
      const dateIndex = h.indexOf("日付");
      if (dateIndex >= 0) for (const r of item.rows.slice(1)) {
        const d = dateIso(r[dateIndex]); if (d) daySet.add(d);
      }
    }
    const days = Array.from(daySet).sort();
    const start = days[0] || "";
    const end = days[days.length - 1] || "";
    const archiveName = parsed[0]?.name || file.name;
    const stampMatch = archiveName.match(/^(\d{10,})-/) || file.name.match(/^(\d{10,})-/);
    const reportId = stampMatch ? stampMatch[1] : (start && end ? start + "_" + end : file.name);
    const result = blankReport(accountId, start, end, reportId);
    const productMap = new Map();
    const categoryMap = new Map();

    for (const item of parsed) {
      const name = item.name.toLowerCase();
      const rows = item.rows, h = rows[0];
      if (name.includes("tracking-id")) {
        result.sourceTypes.push("tracking");
        const ix = {
          id: col(h, ["トラッキングID"]), clicks: col(h, ["クリック数"]),
          orders: col(h, ["注文済み商品"]), orderedSales: col(h, ["注文商品売上"]),
          shipped: col(h, ["発送済み商品"]), returns: col(h, ["返品済み商品"]),
          sales: col(h, ["発送済み商品売上"]), fee: col(h, ["紹介料合計"])
        };
        for (const r of rows.slice(1)) {
          if (ix.id < 0) continue;
          const id = String(r[ix.id] || "").trim();
          if (!id) continue;
          result.trackingIds.push({
            id, clicks: numeric(r[ix.clicks]), orderedItems: numeric(r[ix.orders]),
            orderedSales: numeric(r[ix.orderedSales]), shippedItems: numeric(r[ix.shipped]),
            returns: numeric(r[ix.returns]), shippedSales: numeric(r[ix.sales]),
            commission: numeric(r[ix.fee])
          });
        }
      } else if (name.includes("linked-product")) {
        result.sourceTypes.push("products");
        const ix = {
          date: h.indexOf("日付"), category: h.indexOf("カテゴリー"),
          title: h.indexOf("商品名"), asin: h.indexOf("ASIN"),
          clicks: h.indexOf("クリック数"), shipped: h.indexOf("発送済み商品"),
          sales: h.indexOf("発送済み商品売上"), fee: h.indexOf("発送済み商品の紹介料")
        };
        for (const r of rows.slice(1)) {
          const asin = ix.asin >= 0 ? String(r[ix.asin] || "").trim() : "";
          if (!asin || asin === "Other" || asin === "None") continue;
          const key = asin + "|" + dateIso(r[ix.date]);
          const p = productMap.get(key) || {
            asin, date: dateIso(r[ix.date]),
            title: ix.title >= 0 ? String(r[ix.title] || "").trim() : "",
            category: ix.category >= 0 ? String(r[ix.category] || "").trim() : "",
            clicks: 0, shippedItems: 0, shippedSales: 0, commission: 0
          };
          p.clicks += numeric(r[ix.clicks]);
          p.shippedItems += numeric(r[ix.shipped]);
          p.shippedSales += numeric(r[ix.sales]);
          p.commission += numeric(r[ix.fee]);
          productMap.set(key, p);
        }
      } else if (name.includes("category")) {
        result.sourceTypes.push("categories");
        const ix = {
          date: h.indexOf("日付"), category: h.indexOf("カテゴリー"),
          clicks: h.indexOf("クリック数"), shipped: h.indexOf("発送済み商品"),
          sales: h.indexOf("発送済み商品売上"), fee: h.indexOf("発送済み商品の紹介料")
        };
        for (const r of rows.slice(1)) {
          const category = ix.category >= 0 ? String(r[ix.category] || "").trim() : "";
          if (!category) continue;
          const key = category + "|" + dateIso(r[ix.date]);
          const c = categoryMap.get(key) || {
            category, date: dateIso(r[ix.date]), clicks: 0,
            shippedItems: 0, shippedSales: 0, commission: 0
          };
          c.clicks += numeric(r[ix.clicks]);
          c.shippedItems += numeric(r[ix.shipped]);
          c.shippedSales += numeric(r[ix.sales]);
          c.commission += numeric(r[ix.fee]);
          categoryMap.set(key, c);
        }
      }
    }
    result.products = Array.from(productMap.values());
    result.categories = Array.from(categoryMap.values());
    const topFile = parsed.find(x => x.name.toLowerCase().includes("top-sellers"));
    if (topFile) {
      result.sourceTypes.push("topSellers");
      const h = topFile.rows[0];
      const ix = {rank: h.indexOf("順位"), asin: h.indexOf("ASIN"), title: h.indexOf("商品名"), category: h.indexOf("カテゴリー"), type: h.indexOf("購入タイプ")};
      result.topSellers = topFile.rows.slice(1).map(r => ({rank: numeric(r[ix.rank]), asin: String(r[ix.asin] || ""), title: String(r[ix.title] || ""), category: String(r[ix.category] || ""), type: String(r[ix.type] || "")})).filter(x => x.asin || x.title);
    }
    if (!result.sourceTypes.length) return null;
    if (result.trackingIds.length) {
      result.clicks = result.trackingIds.reduce((s, x) => s + x.clicks, 0);
      result.orderedItems = result.trackingIds.reduce((s, x) => s + x.orderedItems, 0);
      result.orderedSales = result.trackingIds.reduce((s, x) => s + x.orderedSales, 0);
      result.shippedItems = result.trackingIds.reduce((s, x) => s + x.shippedItems, 0);
      result.shippedSales = result.trackingIds.reduce((s, x) => s + x.shippedSales, 0);
      result.returns = result.trackingIds.reduce((s, x) => s + x.returns, 0);
      result.commission = result.trackingIds.reduce((s, x) => s + x.commission, 0);
    } else {
      result.clicks = result.categories.reduce((s, x) => s + x.clicks, 0);
      result.shippedItems = result.categories.reduce((s, x) => s + x.shippedItems, 0);
      result.shippedSales = result.categories.reduce((s, x) => s + x.shippedSales, 0);
      result.commission = result.categories.reduce((s, x) => s + x.commission, 0);
    }
    return result;
  }

  function combinedPeriods(reports) {
    const groups = new Map();
    for (const report of reports) {
      const period = report.start || report.end
        ? (report.start || "") + "|" + (report.end || "")
        : "unknown|" + (report.reportId || report.key || "");
      if (!groups.has(period)) groups.set(period, new Map());
      const accounts = groups.get(period);
      const old = accounts.get(report.accountId);
      const oldTime = Date.parse(old?.importedAt || "") || 0;
      const newTime = Date.parse(report.importedAt || "") || 0;
      if (!old || newTime >= oldTime) accounts.set(report.accountId, report);
    }
    return Array.from(groups.values()).map(accounts => {
      const rows = Array.from(accounts.values());
      const first = rows[0] || {};
      const combined = {
        start: rows.map(x => x.start).filter(Boolean).sort()[0] || "",
        end: rows.map(x => x.end).filter(Boolean).sort().slice(-1)[0] || "",
        accountCount: rows.length,
        reportCount: rows.length,
        clicks: 0, shippedItems: 0, shippedSales: 0, commission: 0,
        products: [], topSellers: []
      };
      for (const field of ["clicks", "shippedItems", "shippedSales", "commission"]) {
        combined[field] = rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
      }
      const products = new Map();
      for (const row of rows) for (const product of row.products || []) {
        const key = String(product.asin || product.title || "") + "|" + String(product.date || "");
        if (!key || key === "|") continue;
        const current = products.get(key) || {
          ...product, clicks: 0, shippedItems: 0, shippedSales: 0, commission: 0
        };
        for (const field of ["clicks", "shippedItems", "shippedSales", "commission"])
          current[field] += Number(product[field]) || 0;
        products.set(key, current);
      }
      combined.products = Array.from(products.values());
      const sellers = new Map();
      for (const row of rows) for (const product of row.topSellers || []) {
        const key = String(product.asin || product.title || "");
        if (key && !sellers.has(key)) sellers.set(key, product);
      }
      combined.topSellers = Array.from(sellers.values()).sort((x,y) =>
        (Number(x.rank) || Number.MAX_SAFE_INTEGER) - (Number(y.rank) || Number.MAX_SAFE_INTEGER));
      combined._sourcePeriod = first.start || first.end || "";
      return combined;
    }).sort((a,b) => (a.end || a.start || "").localeCompare(b.end || b.start || ""));
  }

  function render() {
    const reports = loadReports();
    if (!reports.length) {
      summary.innerHTML = '<p class="amazon-empty">AmazonのレポートZIPを選ぶと、2アカウント分を期間ごとに自動で合算します。</p>';
      return;
    }
    const periods = combinedPeriods(reports);
    const latest = periods[periods.length - 1];
    const metrics = [
      ["紹介料（合算）", money(latest.commission)],
      ["発送売上（合算）", money(latest.shippedSales)],
      ["クリック（合算）", number(latest.clicks)],
      ["発送商品（合算）", number(latest.shippedItems)]
    ];
    const range = latest.start
      ? safe(latest.start) + (latest.end && latest.end !== latest.start ? "〜" + safe(latest.end) : "")
      : "期間不明";
    let html = '<div class="amazon-primary-report"><strong>全アカウント合計（' +
      number(latest.accountCount) + 'アカウント）</strong><span>' + range +
      '</span><div class="amazon-metrics">' +
      metrics.map(x => '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join("") +
      '</div></div>';
    const top = latest.products.filter(p => p.shippedItems > 0 || p.commission > 0)
      .sort((a,b) => b.commission - a.commission || b.shippedItems - a.shippedItems).slice(0,5);
    if (top.length) {
      html += '<details class="amazon-product-details"><summary>購入商品（参考・投稿との対応は不明）</summary>' +
        '<p class="amazon-attribution-note">Amazon経由で購入された商品の参考情報です。購入者がサンリオ投稿で紹介した商品を買ったことや、特定の投稿から発生した売上を示すものではありません。</p>' +
        '<ol class="amazon-product-list">' +
        top.map(p => '<li><span>' + safe(p.title || p.asin) + '</span><small>' +
          number(p.shippedItems) + '点・' + money(p.commission) + '・' +
          '<a href="https://www.amazon.co.jp/dp/' + encodeURIComponent(p.asin) + '" target="_blank" rel="noopener">商品</a></small></li>').join("") +
        '</ol></details>';
    } else if (latest.topSellers.length) {
      html += '<details class="amazon-product-details"><summary>購入商品ランキング（参考・投稿との対応は不明）</summary>' +
        '<p class="amazon-attribution-note">Amazon経由の購入全体の参考情報です。サンリオ投稿や特定商品の売上を示すものではありません。</p>' +
        '<ol class="amazon-product-list">' +
        latest.topSellers.slice(0,5).map(p => '<li><span>' + safe(p.title || p.asin) + '</span><small>' +
          safe(p.category) + '・' + safe(p.type) + '</small></li>').join("") + '</ol></details>';
    } else {
      html += '<p class="amazon-empty">この期間の商品別実績はありません。</p>';
    }
    if (periods.length > 1) {
      html += '<details class="amazon-history"><summary>期間別の合算履歴（' + number(periods.length) + '期間）</summary><div class="amazon-history-list">' +
        periods.slice().reverse().map(r => '<div class="amazon-history-row"><b>' +
          (r.start ? safe(r.start) + (r.end && r.end !== r.start ? "〜" + safe(r.end) : "") : "期間不明") +
          '</b><span>' + number(r.accountCount) + 'アカウント</span><span>' +
          number(r.clicks) + 'クリック</span><strong>' + money(r.commission) + '</strong></div>').join("") +
        '</div></details>';
    }
    summary.innerHTML = html;
  }

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    input.disabled = true;
    status.textContent = "ZIPを端末内で解析しています…";
    try {
      const JSZip = await loadZipLibrary();
      const parsed = [];
      for (const file of files) parsed.push(await readArchive(file, JSZip));
      const usable = parsed.filter(Boolean);
      const existing = loadReports();
      const byKey = new Map(existing.map(x => [x.key, x]));
      function mergeReport(old, next) {
        if (!old) return next;
        const out = {...old,
          start: [old.start,next.start].filter(Boolean).sort()[0] || "",
          end: [old.end,next.end].filter(Boolean).sort().slice(-1)[0] || "",
          importedAt: next.importedAt || old.importedAt,
          sourceTypes: Array.from(new Set([...(old.sourceTypes || []), ...(next.sourceTypes || [])]))};
        for (const type of next.sourceTypes || []) {
          if (type === "tracking") out.trackingIds = next.trackingIds;
          if (type === "products") out.products = next.products;
          if (type === "categories") out.categories = next.categories;
          if (type === "topSellers") out.topSellers = next.topSellers;
        }
        const tracking = out.sourceTypes.includes("tracking") ? out.trackingIds : [];
        if (tracking.length) {
          for (const field of ["clicks","orderedItems","orderedSales","shippedItems","shippedSales","returns","commission"])
            out[field] = tracking.reduce((sum,row) => sum + (Number(row[field]) || 0),0);
        } else if (out.sourceTypes.includes("categories")) {
          out.clicks = out.categories.reduce((sum,row) => sum + (Number(row.clicks) || 0),0);
          out.shippedItems = out.categories.reduce((sum,row) => sum + (Number(row.shippedItems) || 0),0);
          out.shippedSales = out.categories.reduce((sum,row) => sum + (Number(row.shippedSales) || 0),0);
          out.commission = out.categories.reduce((sum,row) => sum + (Number(row.commission) || 0),0);
        }
        return out;
      }
      const grouped = new Map();
      for (const report of usable) grouped.set(report.key, mergeReport(grouped.get(report.key), report));
      const selectedNames = new Map();
      for (const file of files) {
        const id = accountFromName(file.name);
        if (!selectedNames.has(id)) selectedNames.set(id, new Set());
        selectedNames.get(id).add(file.name);
      }
      for (const [key, report] of grouped) {
        let combined = report;
        const matchingOld = existing.filter(old => old.accountId === report.accountId &&
          ((report.start && report.end && old.start === report.start && old.end === report.end) ||
           (selectedNames.get(report.accountId) && selectedNames.get(report.accountId).has(old.reportId))));
        for (const old of matchingOld) combined = mergeReport(old, combined);
        for (const old of matchingOld) if (old.key !== key) byKey.delete(old.key);
        byKey.set(key, mergeReport(byKey.get(key), combined));
      }
      const updated = Array.from(byKey.values()).sort((a,b) =>
        (a.start || "").localeCompare(b.start || "") || a.accountId.localeCompare(b.accountId));
      localStorage.setItem(STORE_KEY, JSON.stringify(updated));
      status.textContent = files.length + "件のZIPを確認し、" + grouped.size +
        "アカウント・期間レポートに統合しました。同じレポートは更新し、他の記録は保持しました。端末内だけに保存しています。";
      render();
    } catch (error) {
      status.textContent = "取り込みできませんでした：" + (error && error.message ? error.message : String(error));
    } finally {
      input.disabled = false;
      input.value = "";
    }
  });
  clearButton.addEventListener("click", () => {
    if (!confirm("この端末に保存したAmazonレポートを削除しますか？")) return;
    localStorage.removeItem(STORE_KEY);
    status.textContent = "この端末のAmazonレポートを削除しました。";
    render();
  });

  async function importFromLink() {
    const match = location.hash.match(/(?:^#|&)amazon-import=([^&]+)/);
    if (!match) return;
    try {
      const binary = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      if (!("DecompressionStream" in window)) throw new Error("このブラウザーはリンク取り込みに対応していません");
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const payload = JSON.parse(await new Response(stream).text());
      if (payload.version !== 1 || !Array.isArray(payload.reports)) throw new Error("レポート形式が違います");
      const sourceFiles = new Set(payload.sourceFiles || []);
      const existing = loadReports();
      const keep = existing.filter(old => !payload.reports.some(report =>
        old.accountId === report.accountId &&
        ((report.start && report.end && old.start === report.start && old.end === report.end) ||
         sourceFiles.has(old.reportId))));
      const byKey = new Map(keep.map(item => [item.key, item]));
      for (const report of payload.reports) {
        if (!report || !report.accountId || !report.key) throw new Error("アカウント情報がありません");
        byKey.set(report.key, report);
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(byKey.values())));
        history.replaceState(null, "", location.pathname + location.search);
      status.textContent = payload.reports.length + "件のAmazonレポートをこの端末に保存しました。別期間の既存データは残しています。";
      render();
    } catch (error) {
      status.textContent = "リンクからの取り込みに失敗しました：" + (error && error.message ? error.message : String(error));
    }
  }
  importFromLink();

  const style = document.createElement("style");
  style.textContent = ".amazon-import-card .amazon-import-label{display:inline-flex;align-items:center;justify-content:center;margin-top:10px}.amazon-import-card .amazon-primary-select{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:.9rem}.amazon-import-card select{max-width:190px;padding:9px;border:1px solid #ddd;border-radius:10px;background:#fff}.amazon-import-card .amazon-primary-report{margin:14px 0;padding:14px;border-radius:14px;background:#fff7fb;border:1px solid #f0dce7}.amazon-import-card .amazon-primary-report>span{display:block;color:#7d7480;font-size:.85rem;margin-top:4px}.amazon-import-card .amazon-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.amazon-import-card .amazon-metrics div{background:#fff;border-radius:10px;padding:10px}.amazon-import-card .amazon-metrics span,.amazon-import-card .amazon-metrics b{display:block}.amazon-import-card .amazon-metrics span{font-size:.8rem;color:#777}.amazon-import-card .amazon-metrics b{font-size:1.05rem;margin-top:3px}.amazon-import-card h3{font-size:1rem;margin:16px 0 8px}.amazon-import-card .amazon-product-details{margin:14px 0}.amazon-import-card .amazon-product-details summary{cursor:pointer;font-weight:700;padding:10px 12px;border-radius:10px;background:#f7f3f6}.amazon-import-card .amazon-attribution-note{margin:8px 0;padding:10px 12px;border-left:3px solid #d97da6;background:#fff7fb;color:#6f6570;font-size:.85rem;line-height:1.55}.amazon-import-card .amazon-product-list{padding-left:22px}.amazon-import-card .amazon-product-list li{padding:8px 0;border-bottom:1px solid #eee}.amazon-import-card .amazon-product-list small{display:block;color:#777;margin-top:4px}.amazon-import-card .amazon-product-list a{margin-left:6px}.amazon-import-card .amazon-empty{color:#777;font-size:.9rem}.amazon-import-card .amazon-history{margin-top:14px}.amazon-import-card .amazon-history-list{margin-top:8px}.amazon-import-card .amazon-history-row{display:grid;grid-template-columns:1.1fr 1.3fr 1fr auto;gap:6px;padding:8px 0;border-bottom:1px solid #eee;font-size:.8rem}.amazon-import-card .amazon-history-row span{color:#777}.amazon-import-card .amazon-import-label input{display:none}@media(max-width:480px){.amazon-import-card .amazon-history-row{grid-template-columns:1fr 1fr}.amazon-import-card .amazon-history-row strong{text-align:right}}";
  document.head.appendChild(style);
  render();
})();