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
