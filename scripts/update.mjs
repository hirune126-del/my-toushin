// 投資信託協会「投信総合検索ライブラリー」から基準価額データを取得し、data/ 以下に JSON として保存する。
// GitHub Actions から毎日実行される想定（ローカルでも `node scripts/update.mjs` で実行可）。
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const NAV = join(DATA, "nav");
const BASE = "https://toushin-lib.fwg.ne.jp/FdsWeb";
const PAGE = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

async function withRetry(fn, label) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 4) throw new Error(`${label}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

// 全ファンドの一覧（最新基準価額つき）
async function fetchFundList() {
  const out = [];
  let total = Infinity;
  for (let start = 0; start < total; start += PAGE) {
    const info = await withRetry(async () => {
      const res = await fetch(`${BASE}/FDST999900/fundDataSearch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startNo: start, draw: 1, searchBtnClickFlg: true, pageSize: PAGE }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).searchResultInfo;
    }, `fund list ${start}`);
    total = Number(info.recordsTotal);
    for (const f of info.resultInfoMapList) {
      out.push({
        c: f.associFundCd, // 協会コード
        i: f.isinCd, // ISIN
        n: (f.fundStNm || f.fundNm || "").normalize("NFKC"), // 略称
        nn: (f.fundNkNm || "").normalize("NFKC"), // 愛称
        co: (f.entrustCmpNm || "").normalize("NFKC"), // 運用会社
        p: num(f.standardPrice), // 基準価額
        ch: num(f.stdCostPointFrmDayBfr), // 前日比
        r: num(f.stdCostPointFrmDayBfrRt), // 前日比(%)
        a: num(f.totalNetAssets), // 純資産(百万円)
        t: num(f.trustReward), // 信託報酬(%)
        d: (f.standardDate || "").slice(0, 10), // 基準日
        r1: num(f.standardPriceRa1y), // 1年リターン(%)
      });
    }
    await sleep(500);
  }
  out.sort((a, b) => a.c.localeCompare(b.c));
  return out;
}

// 1ファンドの基準価額履歴（CSV, Shift_JIS）
async function fetchHistory(fund) {
  const url = `${BASE}/FDST030000/csv-file-download?isinCd=${fund.i}&associFundCd=${fund.c}`;
  const buf = await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }, `history ${fund.c}`);
  const text = new TextDecoder("shift_jis").decode(buf);
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [d, p, a, div] = line.split(",");
    const m = d && d.match(/(\d{4})年(\d{2})月(\d{2})日/);
    if (!m || !p) continue;
    const row = [`${m[1]}-${m[2]}-${m[3]}`, Number(p)];
    if (div) row.push(Number(div));
    rows.push(row);
  }
  return rows;
}

async function readTargets() {
  const txt = await readFile(join(ROOT, "funds.txt"), "utf8").catch(() => "");
  const codes = new Set();
  for (const line of txt.split(/\r?\n/)) {
    const s = line.replace(/#.*/, "").trim().normalize("NFKC").toUpperCase();
    if (!s) continue;
    for (const tok of s.split(/[\s,]+/)) if (tok) codes.add(tok);
  }
  return codes;
}

await mkdir(NAV, { recursive: true });

const funds = await fetchFundList();
const latest = funds.reduce((m, f) => (f.d > m ? f.d : m), "");
await writeFile(join(DATA, "funds.json"), JSON.stringify({ updated: new Date().toISOString(), date: latest, funds }));
console.log(`funds.json: ${funds.length} funds (基準日 ${latest})`);

// funds.txt に書かれたコード（協会コード or ISIN）の履歴を取得
const targets = await readTargets();
const byCode = new Map();
for (const f of funds) {
  byCode.set(f.c, f);
  byCode.set(f.i, f);
}
const keep = new Set();
for (const code of targets) {
  const f = byCode.get(code);
  if (!f) {
    console.warn(`見つかりません: ${code}`);
    continue;
  }
  const rows = await fetchHistory(f);
  await writeFile(join(NAV, `${f.c}.json`), JSON.stringify(rows));
  keep.add(`${f.c}.json`);
  console.log(`nav/${f.c}.json: ${rows.length} rows  ${f.n}`);
  await sleep(500);
}
// funds.txt から外されたファンドの履歴は削除
for (const file of await readdir(NAV)) {
  if (file.endsWith(".json") && !keep.has(file)) await unlink(join(NAV, file));
}
await writeFile(join(NAV, "index.json"), JSON.stringify([...keep].map((f) => f.replace(".json", "")).sort()));

// ---------- 株価指数・為替（Yahoo Finance） ----------
// 非公式の取得元のため、失敗しても投信データの公開は止めない
const MARKETS = [
  { id: "N225", s: "^N225", name: "日経平均株価", unit: "円", dec: 2 },
  { id: "DJI", s: "^DJI", name: "NYダウ", unit: "ドル", dec: 2 },
  { id: "GSPC", s: "^GSPC", name: "S&P500", unit: "", dec: 2 },
  { id: "IXIC", s: "^IXIC", name: "NASDAQ総合", unit: "", dec: 2 },
  { id: "SOX", s: "^SOX", name: "SOX指数（半導体）", unit: "", dec: 2 },
  { id: "USDJPY", s: "JPY=X", name: "米ドル/円", unit: "円", dec: 2 },
  { id: "EURJPY", s: "EURJPY=X", name: "ユーロ/円", unit: "円", dec: 2 },
];
const MKT = join(DATA, "mkt");
await mkdir(MKT, { recursive: true });

async function fetchMarket(m) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.s)}?range=10y&interval=1d`;
  const res = await withRetry(async () => {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j.chart?.result?.[0]) throw new Error("no data");
    return j.chart.result[0];
  }, `market ${m.s}`);
  const off = res.meta.gmtoffset || 0;
  const day = (t) => new Date((t + off) * 1000).toISOString().slice(0, 10);
  const weekday = (t) => ![0, 6].includes(new Date((t + off) * 1000).getUTCDay());
  const close = res.indicators.quote[0].close;
  const rows = [];
  res.timestamp.forEach((t, i) => {
    if (close[i] == null || !weekday(t)) return;
    const d = day(t), v = Math.round(close[i] * 100) / 100;
    if (rows.length && rows[rows.length - 1][0] === d) rows[rows.length - 1][1] = v;
    else rows.push([d, v]);
  });
  // 最新値（取引中の場合は現在値）で末尾を更新
  const { regularMarketPrice: p, regularMarketTime: t } = res.meta;
  if (p != null && t && weekday(t)) {
    const d = day(t), v = Math.round(p * 100) / 100;
    if (rows.length && rows[rows.length - 1][0] === d) rows[rows.length - 1][1] = v;
    else if (!rows.length || rows[rows.length - 1][0] < d) rows.push([d, v]);
  }
  return rows;
}

const markets = [];
for (const m of MARKETS) {
  try {
    const rows = await fetchMarket(m);
    if (rows.length < 2) throw new Error("rows < 2");
    const [d, p] = rows[rows.length - 1], prev = rows[rows.length - 2][1];
    await writeFile(join(MKT, `${m.id}.json`), JSON.stringify(rows));
    markets.push({ id: m.id, name: m.name, unit: m.unit, dec: m.dec, p, d, ch: Math.round((p - prev) * 100) / 100, r: Math.round(((p - prev) / prev) * 10000) / 100 });
    console.log(`mkt/${m.id}.json: ${rows.length} rows  ${m.name} ${p} (${d})`);
  } catch (e) {
    console.warn(`取得失敗: ${m.name}: ${e.message}`);
  }
  await sleep(500);
}
await writeFile(join(DATA, "markets.json"), JSON.stringify({ updated: new Date().toISOString(), markets }));
