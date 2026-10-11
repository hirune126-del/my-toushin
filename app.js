"use strict";

// ---------- 保存データ（端末内 localStorage） ----------
const STORE_KEY = "mytoushin.v1";
const S = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.holdings)) return { watch: [], prefs: {}, ...s };
  } catch {}
  return { holdings: [], watch: [], prefs: {} };
})();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { toast("保存に失敗しました"); }
}

// ---------- 基準価額データ ----------
const D = { markets: [], mktCache: new Map(), funds: new Map(), list: [], date: "", updated: "", navIndex: new Set(), navCache: new Map(), error: null };

async function loadData() {
  try {
    const [fr, nr, mr] = await Promise.all([fetch("data/funds.json"), fetch("data/nav/index.json"), fetch("data/markets.json").catch(() => null)]);
    if (mr?.ok) D.markets = (await mr.json()).markets;
    const fj = await fr.json();
    D.date = fj.date;
    D.updated = fj.updated;
    D.list = fj.funds;
    for (const f of fj.funds) {
      f.key = searchKey(`${f.n} ${f.nn} ${f.co} ${f.c} ${f.i}`);
      D.funds.set(f.c, f);
    }
    if (nr.ok) D.navIndex = new Set(await nr.json());
  } catch (e) {
    D.error = "基準価額データを読み込めませんでした。通信状態を確認してください。";
  }
}

async function loadNav(code) {
  if (D.navCache.has(code)) return D.navCache.get(code);
  if (!D.navIndex.has(code)) return null;
  const res = await fetch(`data/nav/${code}.json`);
  const rows = res.ok ? await res.json() : null;
  D.navCache.set(code, rows);
  return rows;
}

// ---------- ユーティリティ ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d }));
const yen = (n) => (n == null || isNaN(n) ? "—" : `${fmt(Math.round(n))}円`);
const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const signed = (n, d = 0, unit = "") => (n == null || isNaN(n) ? "—" : `${sign(n)}${fmt(Math.abs(n), d)}${unit}`);
const cls = (n) => (n > 0 ? "plus" : n < 0 ? "minus" : "");
const pct = (n) => signed(n, 2, "%");
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (s) => (s ? s.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, "$1/$2/$3") : "");

function searchKey(s) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-ー－]/g, "");
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function applyPrefs() {
  document.documentElement.classList.toggle("jp-colors", !!S.prefs.jpColors);
}

// ---------- 保有の計算 ----------
function positions() {
  const by = new Map();
  for (const h of S.holdings) {
    const p = by.get(h.c) || { c: h.c, units: 0, costTotal: 0, lots: [] };
    p.units += h.units;
    p.costTotal += (h.units * h.cost) / 10000;
    p.lots.push(h);
    by.set(h.c, p);
  }
  return [...by.values()].map((p) => {
    const f = D.funds.get(p.c);
    const price = f?.p;
    const value = price != null ? (p.units * price) / 10000 : null;
    const dayChg = f?.ch != null ? (p.units * f.ch) / 10000 : null;
    return { ...p, f, value, dayChg, gain: value != null ? value - p.costTotal : null, avgCost: p.units ? (p.costTotal / p.units) * 10000 : 0 };
  });
}

// ---------- 画面 ----------
const view = $("#view");
const PALETTE = ["#2a62c4", "#1fa37a", "#e0902a", "#9a5bd1", "#d1495b", "#2bb3c0", "#7a8b2a", "#c45f9e"];

function setChrome({ title = "NAVIGATOR", back = false, tab = null }) {
  $("#title").textContent = title;
  $("#title").classList.toggle("brand", title === "NAVIGATOR");
  $("#backBtn").hidden = !back;
  $("#asof").textContent = D.date ? `${fmtDate(D.date)} 基準` : "";
  for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("on", a.dataset.tab === tab);
}

function fundItem(f, right) {
  return `<a class="item" href="#fund/${encodeURIComponent(f.c)}">
    <div class="main"><div class="name">${esc(f.n)}</div><div class="meta">${esc(f.co)}</div></div>
    <div class="right">${right}</div></a>`;
}

function renderHome() {
  setChrome({ tab: "home" });
  const ps = positions().sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!ps.length) {
    view.innerHTML = `${marketStrip()}<div class="card empty"><p>保有ファンドがまだありません。</p>
      <p class="hint">検索からファンドを探して「保有を追加」してください。</p>
      <a class="btn" href="#search">ファンドを検索</a></div>`;
    return;
  }
  const total = ps.reduce((s, p) => s + (p.value ?? 0), 0);
  const cost = ps.reduce((s, p) => s + p.costTotal, 0);
  const gain = total - cost;
  const day = ps.reduce((s, p) => s + (p.dayChg ?? 0), 0);
  const prev = total - day;
  const alloc = ps.filter((p) => p.value > 0);
  view.innerHTML = `
    ${marketStrip()}
    <section class="card summary">
      <div class="label">評価額合計</div>
      <div class="big">${yen(total)}</div>
      <div class="row">
        <div><div class="label">評価損益</div><div class="val ${cls(gain)}">${signed(gain, 0, "円")}<br><small>${cost ? pct((gain / cost) * 100) : ""}</small></div></div>
        <div><div class="label">前日比</div><div class="val ${cls(day)}">${signed(day, 0, "円")}<br><small>${prev ? pct((day / prev) * 100) : ""}</small></div></div>
      </div>
      <div class="row"><div><div class="label">取得額合計</div><div class="val">${yen(cost)}</div></div></div>
      ${total > 0 ? `<div class="alloc">${alloc.map((p, i) => `<span style="width:${(p.value / total) * 100}%;background:${PALETTE[i % PALETTE.length]}"></span>`).join("")}</div>
      <div class="legend">${alloc.map((p, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(shortName(p.f?.n ?? p.c))} ${fmt((p.value / total) * 100, 1)}%</span>`).join("")}</div>` : ""}
    </section>
    <div class="section-title">保有ファンド（${ps.length}）</div>
    <div class="list">${ps
      .map((p) => {
        const f = p.f || { c: p.c, n: `不明なファンド (${p.c})`, co: "データなし" };
        return fundItem(
          f,
          `<div class="v">${yen(p.value)}</div>
           <div class="s ${cls(p.gain)}">${signed(p.gain, 0, "円")} (${p.costTotal ? pct((p.gain / p.costTotal) * 100) : "—"})</div>
           <div class="s ${cls(f.ch)}">前日比 ${signed(p.dayChg, 0, "円")}</div>`
        );
      })
      .join("")}</div>`;
}

function shortName(n) {
  return n.length > 14 ? n.slice(0, 13) + "…" : n;
}

function renderWatch() {
  setChrome({ tab: "watch" });
  const fs = S.watch.map((c) => D.funds.get(c) || { c, n: `不明なファンド (${c})`, co: "データなし" });
  if (!fs.length) {
    view.innerHTML = `<div class="card empty"><p>ウォッチリストは空です。</p>
      <p class="hint">ファンド詳細の「☆ ウォッチ」で追加できます。My投資信託から書き出したコードは「設定 → コードを一括追加」でまとめて登録できます。</p>
      <a class="btn" href="#search">ファンドを検索</a></div>`;
    return;
  }
  view.innerHTML = `<div class="section-title">ウォッチリスト（${fs.length}）</div>
    <div class="list">${fs
      .map((f) =>
        fundItem(
          f,
          `<div class="v">${f.p != null ? fmt(f.p) + "円" : "—"}</div>
           <div class="s ${cls(f.ch)}">${signed(f.ch)} (${pct(f.r)})</div>`
        )
      )
      .join("")}</div>`;
}

let lastQuery = "";
function renderSearch() {
  setChrome({ tab: "search" });
  view.innerHTML = `<div class="search-box"><input id="q" type="search" placeholder="ファンド名・愛称・運用会社・コードで検索" value="${esc(lastQuery)}" autocomplete="off">
    <div class="hint">全 ${fmt(D.list.length)} 本から検索（純資産の大きい順）</div></div>
    <div id="results"></div>`;
  const q = $("#q");
  const run = () => {
    lastQuery = q.value;
    const words = q.value.split(/[\s　]+/).map(searchKey).filter(Boolean);
    const out = $("#results");
    if (!words.length) {
      out.innerHTML = "";
      return;
    }
    const hits = D.list.filter((f) => words.every((w) => f.key.includes(w))).sort((a, b) => (b.a ?? 0) - (a.a ?? 0));
    out.innerHTML = hits.length
      ? `<div class="list">${hits
          .slice(0, 60)
          .map((f) => fundItem(f, `<div class="v">${f.p != null ? fmt(f.p) + "円" : "—"}</div><div class="s ${cls(f.ch)}">${pct(f.r)}</div>`))
          .join("")}</div>${hits.length > 60 ? `<p class="hint">ほか ${hits.length - 60} 件。キーワードを追加して絞り込んでください。</p>` : ""}`
      : `<div class="card empty">該当するファンドがありません</div>`;
  };
  q.addEventListener("input", run);
  run();
  if (!lastQuery) q.focus();
}

// ---------- マーケット（株価指数・為替） ----------
const HOME_MARKETS = ["N225", "DJI", "USDJPY"];

function marketStrip() {
  const ms = HOME_MARKETS.map((id) => D.markets.find((m) => m.id === id)).filter(Boolean);
  if (!ms.length) return "";
  return `<div class="mstrip">${ms
    .map((m) => `<a href="#mkt/${m.id}"><span class="k">${esc(m.name)}</span><span class="v">${fmt(m.p, m.id === "USDJPY" ? 2 : 0)}</span><span class="s ${cls(m.ch)}">${pct(m.r)}</span></a>`)
    .join("")}</div>`;
}

function renderMarket() {
  setChrome({ tab: "market" });
  if (!D.markets.length) {
    view.innerHTML = `<div class="card empty">株価指数・為替のデータを取得できませんでした。次回の更新をお待ちください。</div>`;
    return;
  }
  view.innerHTML = `<div class="section-title">株価指数・為替</div>
    <div class="list">${D.markets
      .map(
        (m) => `<a class="item" href="#mkt/${m.id}">
        <div class="main"><div class="name">${esc(m.name)}</div><div class="meta">${fmtDate(m.d)}</div></div>
        <div class="right"><div class="v">${fmt(m.p, m.dec)}${esc(m.unit)}</div>
        <div class="s ${cls(m.ch)}">${signed(m.ch, m.dec)} (${pct(m.r)})</div></div></a>`
      )
      .join("")}</div>
    <p class="hint">データ：Yahoo Finance（平日 21:30・翌朝 7:30 更新。リアルタイムではありません）</p>`;
}

async function renderMarketDetail(id) {
  const m = D.markets.find((x) => x.id === id);
  setChrome({ title: "マーケット", back: true });
  if (!m) {
    view.innerHTML = `<div class="card empty">データが見つかりません</div>`;
    return;
  }
  view.innerHTML = `
    <section class="card fund-head">
      <div class="name">${esc(m.name)}</div>
      <div class="price">${fmt(m.p, m.dec)}<small>${esc(m.unit)}</small></div>
      <div class="chg ${cls(m.ch)}">前日比 ${signed(m.ch, m.dec)}${esc(m.unit)}（${pct(m.r)}）</div>
      <div class="hint" style="margin-left:0">${fmtDate(m.d)} 時点</div>
    </section>
    <section class="card"><h2>チャート</h2><div id="chart"><div class="loading">読み込み中…</div></div></section>`;
  let rows = D.mktCache.get(id);
  if (!rows) {
    try {
      const r = await fetch(`data/mkt/${id}.json`);
      rows = r.ok ? await r.json() : null;
    } catch {}
    if (rows) D.mktCache.set(id, rows);
  }
  if (location.hash !== `#mkt/${id}`) return;
  if (!rows) {
    $("#chart").innerHTML = `<p class="hint">チャートデータを読み込めませんでした</p>`;
    return;
  }
  chartBox($("#chart"), rows, null, m.dec, m.unit);
}

const RANGES = [["1M", 1], ["3M", 3], ["6M", 6], ["1Y", 12], ["3Y", 36], ["5Y", 60], ["全", 0]];

async function renderFund(code) {
  const f = D.funds.get(code);
  setChrome({ title: "ファンド詳細", back: true });
  if (!f) {
    view.innerHTML = `<div class="card empty">ファンド（${esc(code)}）のデータが見つかりません。償還された可能性があります。</div>
      ${S.holdings.some((h) => h.c === code) || S.watch.includes(code) ? `<button class="btn danger block" id="purge">このファンドを保有・ウォッチから削除</button>` : ""}`;
    $("#purge")?.addEventListener("click", () => {
      S.holdings = S.holdings.filter((h) => h.c !== code);
      S.watch = S.watch.filter((c) => c !== code);
      save();
      history.back();
    });
    return;
  }
  const pos = positions().find((p) => p.c === code);
  const watching = S.watch.includes(code);
  view.innerHTML = `
    <section class="card fund-head">
      <div class="name">${esc(f.n)}</div>
      <div class="co">${esc(f.co)}${f.nn ? ` ／ 愛称：${esc(f.nn)}` : ""}</div>
      <div class="price">${fmt(f.p)}<small>円</small></div>
      <div class="chg ${cls(f.ch)}">前日比 ${signed(f.ch)}円（${pct(f.r)}）</div>
      <div class="hint" style="margin-left:0">${fmtDate(f.d)} 基準</div>
      <div class="btns" style="margin-top:12px">
        <a class="btn" href="#add/${encodeURIComponent(code)}">＋ 保有を追加</a>
        <button class="btn ghost" id="watchBtn">${watching ? "★ ウォッチ中" : "☆ ウォッチ"}</button>
      </div>
    </section>
    <section class="card"><h2>基準価額チャート</h2><div id="chart"><div class="loading">読み込み中…</div></div></section>
    ${pos ? holdingsCard(pos) : ""}
    <section class="card"><div class="stats">
      <div><div class="k">純資産総額</div><div class="v">${f.a != null ? fmtOku(f.a) : "—"}</div></div>
      <div><div class="k">信託報酬（税込）</div><div class="v">${f.t != null ? fmt(f.t, 3).replace(/0+$/, "").replace(/\.$/, "") + "%" : "—"}</div></div>
      <div><div class="k">1年リターン</div><div class="v ${cls(f.r1)}">${pct(f.r1)}</div></div>
      <div><div class="k">協会コード</div><div class="v">${esc(f.c)}</div></div>
      <div><div class="k">ISIN</div><div class="v">${esc(f.i)}</div></div>
    </div></section>`;
  $("#watchBtn").addEventListener("click", () => {
    if (S.watch.includes(code)) S.watch = S.watch.filter((c) => c !== code);
    else S.watch.push(code);
    save();
    toast(S.watch.includes(code) ? "ウォッチリストに追加しました" : "ウォッチリストから外しました");
    renderFund(code);
  });

  const box = $("#chart");
  let rows = null;
  try { rows = await loadNav(code); } catch {}
  if (location.hash !== `#fund/${encodeURIComponent(code)}`) return;
  if (!rows || !rows.length) {
    box.innerHTML = `<p class="hint" style="margin:0 0 10px">このファンドの履歴データはまだありません。GitHub の <b>funds.txt</b> に <b>${esc(code)}</b> を追加すると、数分後の更新からチャートが表示されます。</p>
      <button class="btn ghost small" id="copyCode">コードをコピー</button>`;
    $("#copyCode").addEventListener("click", () => copy(code));
    return;
  }
  // 最新の基準価額が履歴より新しければ末尾に足す
  if (f.p != null && f.d > rows[rows.length - 1][0]) rows = [...rows, [f.d, f.p]];
  chartBox(box, rows, pos?.avgCost);
}

// 期間切り替えボタンつきのチャート
function chartBox(box, rows, cost, dec = 0, unit = "円") {
  const range = S.prefs.range ?? 12;
  box.innerHTML = `<div class="ranges">${RANGES.map(([l, m]) => `<button data-m="${m}" class="${m === range ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="chart-info" id="cinfo"></div><div class="chart-wrap" id="cwrap"></div>`;
  const draw = (m) => {
    let r = rows;
    if (m) {
      const d = new Date(rows[rows.length - 1][0]);
      d.setMonth(d.getMonth() - m);
      const from = d.toISOString().slice(0, 10);
      r = rows.filter((x) => x[0] >= from);
    }
    drawChart($("#cwrap"), $("#cinfo"), r, cost, dec, unit);
  };
  box.querySelector(".ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const m = Number(b.dataset.m);
    S.prefs.range = m;
    save();
    box.querySelectorAll(".ranges button").forEach((x) => x.classList.toggle("on", x === b));
    draw(m);
  });
  draw(range);
}

function fmtOku(m) {
  // 百万円 → 億円 表記
  return m >= 100 ? `${fmt(m / 100, m >= 10000 ? 0 : 1)}億円` : `${fmt(m)}百万円`;
}

function holdingsCard(p) {
  return `<section class="card"><h2>保有状況</h2>
    <div class="stats" style="margin-bottom:12px">
      <div><div class="k">評価額</div><div class="v">${yen(p.value)}</div></div>
      <div><div class="k">評価損益</div><div class="v ${cls(p.gain)}">${signed(p.gain, 0, "円")}<br><small>${p.costTotal ? pct((p.gain / p.costTotal) * 100) : ""}</small></div></div>
      <div><div class="k">保有口数</div><div class="v">${fmt(p.units)}口</div></div>
      <div><div class="k">平均取得単価</div><div class="v">${fmt(p.avgCost, 0)}円</div></div>
    </div>
    ${p.lots
      .map((h) => {
        const v = p.f?.p != null ? (h.units * p.f.p) / 10000 : null;
        const g = v != null ? v - (h.units * h.cost) / 10000 : null;
        return `<div class="holding-row"><div>${h.memo ? `<span class="tag">${esc(h.memo)}</span>` : ""}
          <div class="grid2"><span class="k">口数</span><span>${fmt(h.units)}口</span><span class="k">取得単価</span><span>${fmt(h.cost)}円</span><span class="k">損益</span><span class="${cls(g)}">${signed(g, 0, "円")}</span></div></div>
          <a class="btn ghost small" href="#edit/${h.id}">編集</a></div>`;
      })
      .join("")}
  </section>`;
}

function drawChart(wrap, info, rows, cost, dec = 0, unit = "円") {
  if (rows.length < 2) {
    wrap.innerHTML = `<p class="hint">この期間のデータが足りません</p>`;
    info.innerHTML = "";
    return;
  }
  const W = 360, H = 210, L = 2, R = 46, T = 8, B = 22;
  const ps = rows.map((r) => r[1]);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  if (cost && cost > lo * 0.85 && cost < hi * 1.15) { lo = Math.min(lo, cost); hi = Math.max(hi, cost); }
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  lo -= pad; hi += pad;
  const x = (i) => L + (i / (rows.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[1]).toFixed(1)}`);
  const ticks = niceTicks(lo, hi, 4);
  const tdec = [0, 1, 2].find((d) => ticks.every((t) => Math.abs(t * 10 ** d - Math.round(t * 10 ** d)) < 1e-6)) ?? 2;
  const first = rows[0], last = rows[rows.length - 1];
  const chgAll = ((last[1] - first[1]) / first[1]) * 100;
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="基準価額チャート">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${W - R + 6}" y="${y(t) + 4}">${fmt(t, tdec)}</text>`).join("")}
    <path class="area" d="M${x(0)},${H - B} L${pts.join(" L")} L${x(rows.length - 1)},${H - B} Z"/>
    <polyline class="line" points="${pts.join(" ")}"/>
    ${cost && cost > lo && cost < hi ? `<line class="cost" x1="${L}" x2="${W - R}" y1="${y(cost)}" y2="${y(cost)}"/><text class="axis" x="${L + 4}" y="${y(cost) - 5}" style="fill:var(--minus)">取得単価 ${fmt(cost)}</text>` : ""}
    <text class="axis" x="${L}" y="${H - 6}">${fmtDate(first[0])}</text>
    <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtDate(last[0])}</text>
    <line class="cursor" id="cur" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="dot" id="dot" r="4.5" visibility="hidden"/>
  </svg>`;
  const base = `<span>期間騰落率 <b class="${cls(chgAll)}">${pct(chgAll)}</b></span><span>${fmtDate(first[0])}〜</span>`;
  info.innerHTML = base;
  const svg = wrap.querySelector("svg"), cur = svg.querySelector("#cur"), dot = svg.querySelector("#dot");
  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(((px - L) / (W - L - R)) * (rows.length - 1))));
    const [d, v] = rows[i];
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(v)); dot.setAttribute("visibility", "visible");
    const c = ((v - first[1]) / first[1]) * 100;
    info.innerHTML = `<span>${fmtDate(d)}　<b>${fmt(v, dec)}${unit}</b></span><span class="${cls(c)}">${pct(c)}</span>`;
  };
  const leave = () => { cur.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); info.innerHTML = base; };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", leave);
  svg.addEventListener("pointercancel", leave);
}

function niceTicks(lo, hi, n) {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

function renderEdit(mode, arg) {
  const h = mode === "edit" ? S.holdings.find((x) => x.id === arg) : { id: uid(), c: arg, units: 0, cost: 0, memo: "" };
  if (!h) { location.replace("#home"); return; }
  const f = D.funds.get(h.c);
  setChrome({ title: mode === "edit" ? "保有を編集" : "保有を追加", back: true });
  let inputMode = S.prefs.inputMode || "amount";
  const price = f?.p;
  view.innerHTML = `<section class="card">
    <div class="fund-head"><div class="name" style="font-size:15px">${esc(f?.n ?? h.c)}</div>
    <div class="co">基準価額 ${fmt(price)}円（${fmtDate(f?.d)}）</div></div></section>
    <section class="card">
      <div class="seg" id="seg"><button data-m="amount">金額で入力</button><button data-m="units">口数で入力</button></div>
      <div id="fields"></div>
      <div class="calc" id="calc"></div>
      <div class="field"><label for="memo">メモ（口座など・任意）</label><input id="memo" placeholder="例：NISA つみたて / 特定口座" value="${esc(h.memo)}"></div>
      <button class="btn block" id="saveBtn">保存</button>
      ${mode === "edit" ? `<button class="btn danger block" id="delBtn" style="margin-top:10px">この保有を削除</button>` : ""}
    </section>`;

  const renderFields = () => {
    $("#seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.m === inputMode));
    const val = h.units && price ? Math.round((h.units * price) / 10000) : "";
    const costAmt = h.units ? Math.round((h.units * h.cost) / 10000) : "";
    $("#fields").innerHTML =
      inputMode === "amount"
        ? `<div class="field"><label for="a1">現在の評価額（円）</label><input id="a1" inputmode="numeric" value="${val}" placeholder="証券会社アプリに表示される評価額"></div>
           <div class="field"><label for="a2">取得額（投資した金額, 円）</label><input id="a2" inputmode="numeric" value="${costAmt}" placeholder="例：500000"></div>`
        : `<div class="field"><label for="u1">保有口数（口）</label><input id="u1" inputmode="numeric" value="${h.units || ""}" placeholder="例：123456"></div>
           <div class="field"><label for="u2">平均取得単価（円／1万口）</label><input id="u2" inputmode="decimal" value="${h.cost || ""}" placeholder="例：25000"></div>`;
    $("#fields").querySelectorAll("input").forEach((i) => i.addEventListener("input", calc));
    calc();
  };
  const num = (id) => {
    const v = Number(($("#" + id)?.value || "").normalize("NFKC").replace(/[,，円口\s]/g, ""));
    return isFinite(v) ? v : NaN;
  };
  const read = () => {
    if (inputMode === "amount") {
      const v = num("a1"), c = num("a2");
      if (!(v > 0) || !(c > 0) || !(price > 0)) return null;
      const units = Math.round((v / price) * 10000);
      return { units, cost: Math.round((c / units) * 10000 * 100) / 100 };
    }
    const u = num("u1"), c = num("u2");
    if (!(u > 0) || !(c > 0)) return null;
    return { units: Math.round(u), cost: c };
  };
  function calc() {
    const r = read();
    $("#calc").innerHTML = r
      ? inputMode === "amount"
        ? `保有口数 約 <b>${fmt(r.units)}口</b> ／ 平均取得単価 <b>${fmt(r.cost)}円</b> として保存します`
        : `評価額 <b>${yen((r.units * price) / 10000)}</b> ／ 取得額 <b>${yen((r.units * r.cost) / 10000)}</b>`
      : "数値を入力してください";
  }
  $("#seg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const r = read();
    if (r) Object.assign(h, r);
    inputMode = b.dataset.m;
    S.prefs.inputMode = inputMode;
    save();
    renderFields();
  });
  $("#saveBtn").addEventListener("click", () => {
    const r = read();
    if (!r) { toast("数値を正しく入力してください"); return; }
    Object.assign(h, r, { memo: $("#memo").value.trim() });
    if (mode === "add") S.holdings.push(h);
    save();
    toast("保存しました");
    location.replace(`#fund/${encodeURIComponent(h.c)}`);
  });
  $("#delBtn")?.addEventListener("click", () => {
    if (!confirm("この保有を削除しますか？")) return;
    S.holdings = S.holdings.filter((x) => x.id !== h.id);
    save();
    toast("削除しました");
    location.replace(`#fund/${encodeURIComponent(h.c)}`);
  });
  renderFields();
}

function allCodes() {
  return [...new Set([...S.holdings.map((h) => h.c), ...S.watch])];
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    prompt("コピーしてください", text);
  }
}

function renderSettings() {
  setChrome({ tab: "settings" });
  const codes = allCodes();
  const missing = codes.filter((c) => !D.navIndex.has(c));
  view.innerHTML = `
    <section class="card"><h2>データ</h2>
      <div class="setting"><div><div>基準日</div><div class="d">最終取得 ${D.updated ? new Date(D.updated).toLocaleString("ja-JP") : "—"}</div></div><b>${fmtDate(D.date) || "—"}</b></div>
      <div class="setting"><div><div>チャート用コードをコピー</div><div class="d">保有・ウォッチ中の ${codes.length} 本${missing.length ? `（うち ${missing.length} 本はチャート未登録）` : ""}。GitHub の funds.txt に貼り付けてください。</div></div>
        <button class="btn ghost small" id="copyAll">コピー</button></div>
    </section>
    <section class="card"><h2>コードを一括追加（ウォッチリスト）</h2>
      <p class="hint" style="margin:0 0 8px">My投資信託から書き出したデータなどを貼り付けると、含まれる協会コード（8桁）・ISINコードを読み取ってウォッチリストに追加します。</p>
      <textarea id="bulk" placeholder="例：0331418A&#10;JP90C000H1T1"></textarea>
      <div style="margin-top:8px"><button class="btn small" id="bulkBtn">追加する</button></div>
    </section>
    <section class="card"><h2>表示</h2>
      <div class="setting"><div><div>プラスを赤・マイナスを青で表示</div><div class="d">オフ：プラス緑・マイナス赤</div></div>
        <input type="checkbox" id="jp" ${S.prefs.jpColors ? "checked" : ""} style="width:22px;height:22px"></div>
    </section>
    <section class="card"><h2>バックアップ</h2>
      <p class="hint" style="margin:0 0 10px">保有・ウォッチリストはこの端末のブラウザ内に保存されています。機種変更の前などに書き出しておいてください。</p>
      <div class="btns"><button class="btn ghost" id="exp">書き出し</button><button class="btn ghost" id="imp">読み込み</button></div>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
    </section>
    <p class="hint" style="text-align:center">基準価額データ：一般社団法人投資信託協会「投信総合検索ライブラリー」<br>本アプリの情報は投資判断の参考であり、正確性を保証するものではありません。</p>`;

  $("#copyAll").addEventListener("click", () => {
    if (!codes.length) { toast("保有・ウォッチ中のファンドがありません"); return; }
    copy(codes.map((c) => `${c}  # ${D.funds.get(c)?.n ?? ""}`).join("\n"));
  });
  $("#bulkBtn").addEventListener("click", () => {
    const text = $("#bulk").value.normalize("NFKC").toUpperCase();
    const found = new Set();
    const byIsin = new Map(D.list.map((f) => [f.i, f.c]));
    for (const m of text.matchAll(/\bJP[0-9A-Z]{10}\b/g)) if (byIsin.has(m[0])) found.add(byIsin.get(m[0]));
    for (const m of text.matchAll(/\b[0-9A-Z]{8}\b/g)) if (D.funds.has(m[0])) found.add(m[0]);
    const added = [...found].filter((c) => !S.watch.includes(c));
    S.watch.push(...added);
    save();
    toast(found.size ? `${added.length} 本を追加しました（重複 ${found.size - added.length} 本）` : "コードが見つかりませんでした");
    if (added.length) $("#bulk").value = "";
  });
  $("#jp").addEventListener("change", (e) => {
    S.prefs.jpColors = e.target.checked;
    save();
    applyPrefs();
  });
  $("#exp").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "mytoushin", version: 1, exported: new Date().toISOString(), ...S }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mytoushin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#imp").addEventListener("click", () => $("#impFile").click());
  $("#impFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.holdings) || !Array.isArray(j.watch)) throw new Error();
      if (!confirm(`保有 ${j.holdings.length} 件・ウォッチ ${j.watch.length} 件で現在のデータを置き換えます。よろしいですか？`)) return;
      S.holdings = j.holdings;
      S.watch = j.watch;
      S.prefs = j.prefs || {};
      save();
      applyPrefs();
      toast("読み込みました");
      renderSettings();
    } catch {
      toast("バックアップファイルを読み込めませんでした");
    }
  });
}

// ---------- ルーティング ----------
function route() {
  window.scrollTo(0, 0);
  if (D.error) {
    view.innerHTML = `<div class="card empty err">${esc(D.error)}</div>`;
    return;
  }
  const [name, arg] = location.hash.slice(1).split("/").map(decodeURIComponent);
  switch (name) {
    case "market": return renderMarket();
    case "mkt": return renderMarketDetail(arg);
    case "watch": return renderWatch();
    case "search": return renderSearch();
    case "settings": return renderSettings();
    case "fund": return renderFund(arg);
    case "add": return renderEdit("add", arg);
    case "edit": return renderEdit("edit", arg);
    default: return renderHome();
  }
}

$("#backBtn").addEventListener("click", () => {
  if (history.length > 1) history.back();
  else location.hash = "#home";
});
window.addEventListener("hashchange", route);

applyPrefs();
view.innerHTML = `<div class="loading">読み込み中…</div>`;
loadData().then(route);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js");
}
