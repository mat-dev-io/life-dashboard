// ブラウザ無し環境向けの end-to-end 検証ハーネス。
// DOM / fetch / Chart.js / localStorage をスタブし、index.html / activity.html の
// <script> を vm で実行して、CSV 統合・欠測 null 化・移動平均・描画文字列を検証する。
// 実行: node test/harness.mjs
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
function assert(name, cond, detail = "") {
  if (cond) { passed++; }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---------- スタブ ----------

class El {
  constructor(id) {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
    this.style = {};
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
}

function extractScript(html) {
  const m = html.match(/<script>\s*("use strict";[\s\S]*?)<\/script>/);
  if (!m) throw new Error("インライン <script> が見つからない");
  return m[1];
}

function collectIds(html) {
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}

async function runPage(file, fixtures) {
  const html = readFileSync(join(root, file), "utf8");
  const ids = collectIds(html);
  const els = new Map();
  const filterButtons = ["7", "30", "90"].map((d) => {
    const b = new El(`filter-${d}`);
    b.dataset.days = d;
    return b;
  });
  const document = {
    documentElement: new El("html"),
    getElementById(id) {
      // JS が参照する id が HTML に実在することを id 網羅チェックとして兼ねる
      if (!ids.has(id)) throw new Error(`${file}: getElementById("${id}") が HTML に存在しない`);
      if (!els.has(id)) els.set(id, new El(id));
      return els.get(id);
    },
    querySelectorAll(sel) {
      return sel.includes(".filters") ? filterButtons : [];
    },
  };
  class ChartStub {
    static defaults = { font: {} };
    static created = [];
    constructor(el, cfg) { this.el = el; this.cfg = cfg; ChartStub.created.push(this); }
    destroy() {}
  }
  const sandbox = {
    document,
    console,
    localStorage: { getItem: () => "dummy-token", setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "#336699" }),
    fetch: async (url) => {
      for (const [key, csv] of Object.entries(fixtures)) {
        if (url.includes(key)) return { ok: true, status: 200, text: async () => csv };
      }
      return { ok: false, status: 404, text: async () => "" };
    },
    Chart: ChartStub,
    IntersectionObserver: class { observe() {} unobserve() {} },
    crypto: webcrypto,
    TextEncoder, TextDecoder, atob, btoa,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractScript(html), sandbox, { filename: file });
  await new Promise((r) => setTimeout(r, 20)); // load() の完了を待つ
  const chartByCanvas = (id) => ChartStub.created.filter((c) => c.el.id === id).at(-1);
  return { els, filterButtons, ChartStub, chartByCanvas, html, sandbox };
}

// ---------- 睡眠ページ ----------

const sleepDaily = `date,sleep_onset,wake_time,latency_min,sleep_min,core_min,deep_min,rem_min,awake_count,awake_min,in_bed_min,efficiency_pct
2026-07-10,23:30,06:30,10,400,250,80,70,2,20,430,93.0
2026-07-11,00:15,07:00,5,380,240,70,70,1,10,405,93.8
2026-07-12,23:00,06:45,8,450,280,90,80,0,0,465,96.8`;

// 帰属ルール検証用: 終了 12 時前→前日 / 12 時以降→当日 / asleep→core / inbed→除外
const sleepSamples = `date,time,state,duration_sec
2026-07-12,23:00:00,core,3600
2026-07-13,00:00:00,deep,1800
2026-07-13,00:30:00,rem,900
2026-07-13,01:00:00,awake,300
2026-07-12,13:00:00,asleep,600
2026-07-11,23:45:00,inbed,600`;

{
  const { els, filterButtons, ChartStub, chartByCanvas, sandbox } = await runPage("index.html", {
    "sleep-daily.csv": sleepDaily,
    "sleep-samples.csv": sleepSamples,
  });
  const t = () => els.get("tiles").innerHTML;

  const ds = () => els.get("dayStats").innerHTML;

  assert("sleep: content 表示", els.get("content").hidden === false);
  assert("sleep: 最新日タイトル", els.get("dayTitle").textContent === "2026-07-12 の睡眠");
  assert("sleep: ヒーロー睡眠時間",
    els.get("heroNum").innerHTML === "7<small>時間</small>30<small>分</small>",
    els.get("heroNum").innerHTML);
  assert("sleep: 目標達成表示", t().includes("目標達成"));
  assert("sleep: リング達成率 107%", t().includes(">107%<"));
  assert("sleep: リング進捗は 100% で頭打ち", t().includes('stroke-dashoffset="0.00"'));
  assert("sleep: 中途覚醒タイル", ds().includes("0<small>回 / 0分</small>"));

  const hypno = chartByCanvas("hypnoChart");
  assert("sleep: 睡眠図が描画される", !!hypno);
  const hypnoData = hypno.cfg.data.datasets[0].data;
  assert("sleep: 睡眠図に inbed は含めない", hypnoData.length === 5, `len=${hypnoData.length}`);
  assert("sleep: asleep→core 正規化", hypnoData.some((d) => d.state === "core" && d.x[0] === 60));
  assert("sleep: 12:00 起点の経過分", hypnoData.some((d) => d.x[0] === 660 && d.x[1] === 720));

  const stack = chartByCanvas("stackChart");
  assert("sleep: 積み上げ 3 系列 + 目標線", stack.cfg.data.datasets.length === 4);
  assert("sleep: deep 系列の値", JSON.stringify(stack.cfg.data.datasets[0].data) === "[80,70,90]");
  assert("sleep: 目標線は 420 分", stack.cfg.data.datasets[3].data.every((y) => y === 420));

  const time = chartByCanvas("timeChart");
  assert("sleep: 入眠時刻の 18:00 起点写像",
    JSON.stringify(time.cfg.data.datasets[0].data) === "[330,375,300]",
    JSON.stringify(time.cfg.data.datasets[0].data));

  const eff = chartByCanvas("effChart");
  assert("sleep: 睡眠効率系列", JSON.stringify(eff.cfg.data.datasets[0].data) === "[93,93.8,96.8]");

  const pattern = chartByCanvas("patternChart");
  assert("sleep: パターン図の区間数", pattern.cfg.data.datasets[0].data.length === 5);

  assert("sleep: 平均睡眠時間", els.get("avgs").innerHTML.includes("6時間50分"));
  assert("sleep: 7 時間達成日数", els.get("avgs").innerHTML.includes("1 / 3 日"));
  assert("sleep: テーブルは新しい日が先頭",
    els.get("dataTable").innerHTML.indexOf("2026-07-12") < els.get("dataTable").innerHTML.indexOf("2026-07-10"));

  // 前日へ: 未達日の表示と、サンプルが無い日の睡眠図非表示
  els.get("prevDay").listeners.click();
  assert("sleep: 前日タイトル", els.get("dayTitle").textContent === "2026-07-11 の睡眠");
  assert("sleep: 前日のヒーロー値",
    els.get("heroNum").innerHTML === "6<small>時間</small>20<small>分</small>");
  assert("sleep: 目標未達の残り時間", t().includes("目標まで 40分"), t());
  assert("sleep: リング達成率 90%", t().includes(">90%<"));
  assert("sleep: サンプル無し日は睡眠図を隠す", els.get("hypnoBlock").hidden === true);

  // 期間フィルタ: 30 日へ切替で再描画される
  const before = ChartStub.created.length;
  filterButtons[1].listeners.click();
  assert("sleep: フィルタ切替で再描画", ChartStub.created.length > before);
  assert("sleep: aria-pressed 更新", filterButtons[1].attrs["aria-pressed"] === "true"
    && filterButtons[0].attrs["aria-pressed"] === "false");

  // 共有パスワード: 暗号化 → 復号の往復と、誤パスワードの拒否（GCM 認証エラー）
  const pat = "github_pat_ROUNDTRIP_TEST";
  const blob = await sandbox.encryptToken(pat, "correct-horse-battery-staple");
  assert("shared: ブロブに平文が含まれない", !JSON.stringify(blob).includes(pat));
  assert("shared: KDF は PBKDF2 60 万回", blob.kdf === "PBKDF2-SHA256" && blob.iterations === 600000);
  assert("shared: 復号往復", await sandbox.decryptToken(blob, "correct-horse-battery-staple") === pat);
  let rejected = false;
  try { await sandbox.decryptToken(blob, "wrong-password-here"); } catch { rejected = true; }
  assert("shared: 誤パスワードは復号失敗", rejected);
}

// ---------- アクティビティページ ----------

const metricsDaily = `date,steps,active_kcal,stand_min,resting_hr,hrv_ms
2026-07-10,8210,320,540,58,45
2026-07-11,12345,410,600,56,
2026-07-12,9500,,480,57,60`;

const healthLog = `date,exercise_min
2026-07-11,30
2026-07-13,20`;

{
  const { els, ChartStub, chartByCanvas } = await runPage("activity.html", {
    "metrics-daily.csv": metricsDaily,
    "health-log.csv": healthLog,
  });
  const t = () => els.get("tiles").innerHTML;
  const ds = () => els.get("dayStats").innerHTML;

  assert("act: content 表示", els.get("content").hidden === false);
  assert("act: 日付ユニオン統合（log のみの日も行になる）",
    els.get("dayTitle").textContent === "2026-07-13 のアクティビティ");
  assert("act: 欠測歩数は −", t().includes("−"));

  els.get("prevDay").listeners.click();
  assert("act: 歩数の桁区切り", els.get("heroNum").innerHTML === "9,500",
    els.get("heroNum").innerHTML);
  assert("act: 欠測 kcal タイルは −", /アクティブ<\/div>\s*<div class="value">−/.test(ds()));

  const steps = chartByCanvas("stepsChart");
  assert("act: 歩数系列（欠測は null）",
    JSON.stringify(steps.cfg.data.datasets[0].data) === "[8210,12345,9500,null]");

  const exercise = chartByCanvas("exerciseChart");
  assert("act: 運動系列は log から統合",
    JSON.stringify(exercise.cfg.data.datasets[0].data) === "[null,30,null,20]");

  const rhr = chartByCanvas("rhrChart");
  assert("act: 安静時心拍は折れ線 + 欠測 null",
    rhr.cfg.type === "line" && JSON.stringify(rhr.cfg.data.datasets[0].data) === "[58,56,57,null]");

  const hrv = chartByCanvas("hrvChart");
  const ma = hrv.cfg.data.datasets[0].data;
  assert("act: HRV 7日移動平均（45,60 → 52.5）", ma.at(-1) === 52.5 && ma.at(-2) === 52.5,
    JSON.stringify(ma));
  assert("act: HRV 日次点は欠測 null",
    JSON.stringify(hrv.cfg.data.datasets[1].data) === "[45,null,60,null]");

  assert("act: 運動日カウント", els.get("avgs").innerHTML.includes("2 / 4 日"));
  assert("act: チャート数（棒4 + 心拍 + HRV）",
    ChartStub.created.length === 6, `created=${ChartStub.created.length}`);
}

// ---------- ページ横断の不変条件 ----------

{
  const idx = readFileSync(join(root, "index.html"), "utf8");
  const act = readFileSync(join(root, "activity.html"), "utf8");
  for (const [name, html] of [["index", idx], ["activity", act]]) {
    assert(`${name}: PAT の localStorage キー共用`, html.includes('"life_dashboard_pat"'));
    assert(`${name}: 共有パスワード UI`, html.includes('id="pwInput"') && html.includes('id="pwSubmit"'));
    assert(`${name}: 共有トークン生成ツール`, html.includes('id="mkShared"') && html.includes('id="mkOut"'));
    assert(`${name}: shared-token.json を参照`, html.includes("assets/shared-token.json"));
    assert(`${name}: ダークモード追従`, html.includes("prefers-color-scheme: dark"));
    assert(`${name}: モーション設定の尊重`, html.includes("prefers-reduced-motion"));
    assert(`${name}: ビルド無し（CDN Chart.js）`, html.includes("cdn.jsdelivr.net/npm/chart.js"));
    assert(`${name}: モバイル幅 720px`, html.includes("max-width: 720px"));
    assert(`${name}: フルスクリーンヒーロー`, html.includes("hero-section"));
    assert(`${name}: 常時ダークバンド`, html.includes("band-dark"));
    assert(`${name}: JS 無効時はステージを縦積み表示`, html.includes(".stagegroup:not(.js)"));
  }
  // スクロール駆動ステージ: タブ数とパネル数が一致すること
  for (const [name, html, groups] of [["index", idx, [4]], ["activity", act, [4, 2]]]) {
    const sections = html.split('class="stagegroup"').slice(1);
    assert(`${name}: ステージグループ数`, sections.length === groups.length,
      `found=${sections.length}`);
    groups.forEach((n, i) => {
      const panels = (sections[i].split('<div class="stagepanels">')[1] ?? "")
        .split('class="stagepanel"').length - 1;
      const tabs = (sections[i].match(/aria-selected=/g) || []).length;
      assert(`${name}: グループ${i + 1} のパネル ${n} 枚`, panels === n, `panels=${panels}`);
      assert(`${name}: グループ${i + 1} のタブ ${n} 個`,
        (sections[i].split("<div class=\"stagepanels\">")[0].match(/aria-selected=/g) || []).length === n,
        `tabs=${tabs}`);
    });
  }
  // デザイン素材: ページが参照するファイルの実在とサイズ上限（肥大の回帰防止）
  const { statSync } = await import("node:fs");
  const assetMax = {
    "assets/hero/sleep-hero.webp": 250_000,
    "assets/hero/activity-hero.webp": 250_000,
    "assets/icon/apple-touch-icon.png": 100_000,
    "assets/icon/icon-192.png": 100_000,
    "assets/icon/icon-512.png": 300_000,
    "assets/icon/favicon-32.png": 20_000,
    "assets/og/og-image.jpg": 300_000,
  };
  for (const [p, max] of Object.entries(assetMax)) {
    let size = -1;
    try { size = statSync(join(root, p)).size; } catch {}
    assert(`asset: ${p} が存在しサイズ上限内`, size > 0 && size <= max, `size=${size}`);
  }
  const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
  assert("asset: manifest のアイコン 2 種", manifest.icons?.length === 2);
  for (const [name, html] of [["index", idx], ["activity", act]]) {
    assert(`${name}: favicon リンク`, html.includes("assets/icon/favicon-32.png"));
    assert(`${name}: apple-touch-icon`, html.includes("assets/icon/apple-touch-icon.png"));
    assert(`${name}: manifest リンク`, html.includes('rel="manifest"'));
    assert(`${name}: OG 画像メタ`, html.includes("assets/og/og-image.jpg"));
  }
  assert("index: ヒーロー背景画像", idx.includes("assets/hero/sleep-hero.webp"));
  assert("activity: ヒーロー背景画像", act.includes("assets/hero/activity-hero.webp"));

  // 各ステージパネルは説明カラム（stagedesc + desc 本文）とグラフカラム（stagefig）を持つ
  for (const [name, html, total] of [["index", idx, 4], ["activity", act, 6]]) {
    const descs = (html.match(/class="stagedesc"/g) || []).length;
    const figs = (html.match(/class="stagefig"/g) || []).length;
    const bodies = (html.match(/class="desc"/g) || []).length;
    assert(`${name}: 説明カラム ${total} 個`, descs === total, `descs=${descs}`);
    assert(`${name}: グラフカラム ${total} 個`, figs === total, `figs=${figs}`);
    assert(`${name}: 説明本文 ${total} 個`, bodies === total, `bodies=${bodies}`);
  }
}

// ---------- 結果 ----------

if (failures.length) {
  console.error(`FAIL: ${failures.length} 件 / PASS: ${passed} 件`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`PASS: 全 ${passed} 件`);
