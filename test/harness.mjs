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

async function runPage(file, fixtures, opts = {}) {
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
    localStorage: {
      getItem: () => (opts.token === undefined ? "dummy-token" : opts.token),
      setItem() {}, removeItem() {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "#336699" }),
    fetch: async (url) => {
      for (const [key, body] of Object.entries(fixtures)) {
        if (url.includes(key)) {
          return { ok: true, status: 200,
                   text: async () => body, json: async () => JSON.parse(body) };
        }
      }
      return { ok: false, status: 404, text: async () => "" };
    },
    Chart: ChartStub,
    IntersectionObserver: class { observe() {} unobserve() {} },
    crypto: webcrypto,
    TextEncoder, TextDecoder, atob, btoa,
    URLSearchParams,
    location: { search: opts.search ?? "" },
  };
  // 「今日」に依存するページ（学習ページの試験カウントダウン・週集計）は時刻を固定する
  if (opts.now) {
    const fixed = Date.parse(opts.now);
    sandbox.Date = class extends Date {
      constructor(...a) { if (!a.length) super(fixed); else super(...a); }
      static now() { return fixed; }
    };
  }
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
  // 単日ヒプノグラム（hypnoChart）と同じ向き: 横軸 = 時刻・縦軸 = 日付
  assert("sleep: パターン図は横向き（横軸 = 時刻）", pattern.cfg.options.indexAxis === "y");
  const patX = pattern.cfg.options.scales.x;
  assert("sleep: 時刻軸は線形", patX.type === "linear");
  assert("sleep: 時刻は左から右へ進む（反転しない）",
    !patX.reverse && !pattern.cfg.options.scales.y.reverse);
  assert("sleep: 時刻軸は 1 時間単位に丸める",
    patX.min === 60 && patX.max === 840, `${patX.min}-${patX.max}`);
  assert("sleep: 時刻目盛りは時刻表記", patX.ticks.callback(660) === "23:00", patX.ticks.callback(660));
  const patSeg = pattern.cfg.data.datasets[0].data[0];
  assert("sleep: 区間は x が時刻レンジ・y が日付",
    Array.isArray(patSeg.x) && patSeg.y === pattern.cfg.data.labels[2],
    JSON.stringify(patSeg));
  const patTip = pattern.cfg.options.plugins.tooltip.callbacks.label({ raw: { state: "core", x: [660, 720] } });
  assert("sleep: パターン図のツールチップは時刻レンジを出す",
    patTip === " Core 23:00〜00:00（1時間）", patTip);

  // 行ラベルは就寝日なので、0 時をまたぐ夜がどこから翌日かを日付境界線で示す
  const patTicks = { ticks: [] };
  patX.afterBuildTicks(patTicks);
  assert("sleep: 00:00 を必ず目盛りに含める",
    patTicks.ticks.some((t) => t.value === 720),
    JSON.stringify(patTicks.ticks.map((t) => t.value)));
  assert("sleep: 目盛りは範囲内に収まる",
    patTicks.ticks.every((t) => t.value >= patX.min && t.value <= patX.max));
  assert("sleep: 日付境界線を太くする",
    patX.grid.lineWidth({ tick: { value: 720 } }) > patX.grid.lineWidth({ tick: { value: 600 } }));
  // 色そのものは検証できない（getComputedStyle のスタブが単一値を返すため）。
  // 境界かどうかで分岐していること自体は lineWidth の差で担保する。

  // 分に丸めてから時分に分解する（59.6 分を 60 にして "06:60" と出さない）
  assert("sleep: 端数の分は繰り上げて時に送る",
    patX.ticks.callback(1139.7) === "07:00", patX.ticks.callback(1139.7));
  assert("sleep: 入眠・起床軸も同じ丸め",
    time.cfg.options.scales.y.ticks.callback(59.7) === "19:00",
    time.cfg.options.scales.y.ticks.callback(59.7));

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

const metricsDaily = `date,steps,active_kcal,stand_min,resting_hr,hrv_ms,weight_kg,body_fat_pct
2026-07-10,8210,320,540,58,45,70.0,20.0
2026-07-11,12345,410,600,56,,71.0,21.0
2026-07-12,9500,,480,57,60,72.0,22.0`;

const healthLog = `date,exercise_min
2026-07-11,30
2026-07-13,20`;

// 体組成の目標。数値はすべて架空（このリポジトリは public なので実データは置かない）
const bodyGoals = JSON.stringify({
  schema_version: 1,
  updated: "2026-07-12",
  targets: {
    weight_kg: { direction: "hold", min: 68, max: 74 },
    body_fat_pct: { direction: "down", max: 24, milestone: 18 },
    lean_body_mass_kg: { direction: "up", min: 54, milestone: 58 },
  },
});

{
  const { els, ChartStub, chartByCanvas } = await runPage("activity.html", {
    "metrics-daily.csv": metricsDaily,
    "health-log.csv": healthLog,
    "body-goals.json": bodyGoals,
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

  // ---- 体組成（体重・体脂肪率・除脂肪体重） ----

  const weight = chartByCanvas("weightChart");
  const wMa = weight.cfg.data.datasets[0].data;
  // 単日の点は主役にしない: 線が 7 日移動平均、点は実測
  assert("act: 体重は 7 日移動平均が主役の線",
    weight.cfg.type === "line" && weight.cfg.data.datasets[0].pointRadius === 0
    && weight.cfg.data.datasets[1].showLine === false);
  // 溜まっていない時期に線を引かない（窓のサンプルが 3 点未満なら null）
  assert("act: 体重 移動平均は 3 点未満なら引かない",
    wMa[0] === null && wMa[1] === null, JSON.stringify(wMa));
  assert("act: 体重 移動平均（70,71,72 → 71）", wMa[2] === 71, JSON.stringify(wMa));
  // 記録が無い日でも、直近 7 日に 3 点あれば線は続く（実測点だけ欠ける）
  assert("act: 欠測日も移動平均の線は続く", wMa[3] === 71, JSON.stringify(wMa));
  assert("act: 体重の実測点は欠測 null",
    JSON.stringify(weight.cfg.data.datasets[1].data) === "[70,71,72,null]",
    JSON.stringify(weight.cfg.data.datasets[1].data));
  // Chart.js の既定 bounds:"ticks" のままだと軸がデータ範囲の外まで伸びる。
  // 体重は変動幅が小さいので、レンジを明示しないとノイズが山脈に見える
  const wy = weight.cfg.options.scales.y;
  assert("act: 体重の Y 軸はゼロ起点にしない", wy.beginAtZero === false);
  assert("act: 体重の Y 軸レンジを明示する（目標バンドを含む）",
    wy.min === 67 && wy.max === 75, `${wy.min}-${wy.max}`);
  assert("act: 体重は目標バンドの上下端を点線で引く",
    weight.cfg.data.datasets.length === 4
    && weight.cfg.data.datasets.slice(2).every((d) => d.borderDash && d.data.every((y, _, a) => y === a[0])),
    JSON.stringify(weight.cfg.data.datasets.map((d) => d.label)));
  assert("act: 目標線のラベルは下限・上限",
    JSON.stringify(weight.cfg.data.datasets.slice(2).map((d) => d.label)) === '["下限","上限"]');

  const fat = chartByCanvas("fatChart");
  assert("act: 体脂肪率 移動平均（20,21,22 → 21）",
    fat.cfg.data.datasets[0].data[2] === 21, JSON.stringify(fat.cfg.data.datasets[0].data));
  assert("act: 体脂肪率は上限と目安の 2 本",
    JSON.stringify(fat.cfg.data.datasets.slice(2).map((d) => d.label)) === '["上限","目安"]');

  const lean = chartByCanvas("leanChart");
  // 除脂肪体重 = 体重 ×（100 − 体脂肪率）。両方そろった日だけ算出する
  assert("act: 除脂肪体重の導出",
    JSON.stringify(lean.cfg.data.datasets[1].data) === "[56,56.1,56.2,null]",
    JSON.stringify(lean.cfg.data.datasets[1].data));
  assert("act: 除脂肪体重の移動平均",
    Math.abs(lean.cfg.data.datasets[0].data[2] - 56.1) < 1e-9,
    JSON.stringify(lean.cfg.data.datasets[0].data));
  assert("act: 除脂肪体重は下限と目安の 2 本",
    JSON.stringify(lean.cfg.data.datasets.slice(2).map((d) => d.label)) === '["下限","目安"]');

  const ds2 = els.get("dayStats").innerHTML;
  assert("act: 体組成は単日タイルにも出す", ds2.includes("除脂肪体重"), ds2);
  const avgs = els.get("avgs").innerHTML;
  assert("act: 期間平均に体重（71.0 kg）", avgs.includes("71.0 kg"), avgs);
  assert("act: 期間平均に体脂肪率（21.0 %）", avgs.includes("21.0 %"), avgs);
  assert("act: テーブルに体重・体脂肪率の列",
    els.get("dataTable").innerHTML.includes("72.0kg")
    && els.get("dataTable").innerHTML.includes("22.0%"),
    els.get("dataTable").innerHTML);

  assert("act: チャート数（棒4 + 心拍 + HRV + 体組成3）",
    ChartStub.created.length === 9, `created=${ChartStub.created.length}`);
}

{
  // 目標が読めなくても推移そのものは読めるので、body-goals.json の欠落では止めない
  const { els, chartByCanvas } = await runPage("activity.html", {
    "metrics-daily.csv": metricsDaily,
    "health-log.csv": healthLog,
  });
  assert("act: 目標が無くても content を表示", els.get("content").hidden === false);
  const weight = chartByCanvas("weightChart");
  assert("act: 目標が無ければ基準線を出さない", weight.cfg.data.datasets.length === 2,
    JSON.stringify(weight.cfg.data.datasets.map((d) => d.label)));
  // 目標線が無いぶんレンジは実測 + 移動平均だけで決まる。最小幅 3kg は保証する
  const wy = weight.cfg.options.scales.y;
  assert("act: 目標が無くても Y 軸に最小幅を保証する",
    wy.max - wy.min >= 3, `${wy.min}-${wy.max}`);
}

{
  // 計測を始めた直後（実測 2 日）は線を引かず、実測点だけを出す
  const { chartByCanvas } = await runPage("activity.html", {
    "metrics-daily.csv": `date,steps,active_kcal,stand_min,resting_hr,hrv_ms,weight_kg,body_fat_pct
2026-07-11,12345,410,600,56,,71.0,21.0
2026-07-12,9500,,480,57,60,72.0,22.0`,
    "body-goals.json": bodyGoals,
  });
  const weight = chartByCanvas("weightChart");
  assert("act: 計測直後は移動平均の線を引かない",
    weight.cfg.data.datasets[0].data.every((v) => v === null),
    JSON.stringify(weight.cfg.data.datasets[0].data));
  assert("act: 計測直後でも実測点は出す",
    JSON.stringify(weight.cfg.data.datasets[1].data) === "[71,72]");
  assert("act: 計測直後でも Y 軸は目標バンドで決まる",
    weight.cfg.options.scales.y.min === 67 && weight.cfg.options.scales.y.max === 75,
    `${weight.cfg.options.scales.y.min}-${weight.cfg.options.scales.y.max}`);
}

// ---------- スクリーンタイムページ ----------

// 7/17 金（平日）, 7/18 土, 7/19 日, 7/20 月（notes=祝日 → 休日扱い）
const screenDaily = `date,total_min,consume_min,pickups,notes
2026-07-17,455,258,27,
2026-07-18,685,610,38,
2026-07-19,529,406,52,
2026-07-20,718,583,39,祝日`;

// 介入前ベースラインは private 側（LIFE/data/health/screen-baseline.json）から読む。
// ここでも実測値は使わない
const screenBaseline = JSON.stringify({
  schema_version: 1,
  period: { from: "2026-06-01", to: "2026-06-20", days: 20 },
  weekday: { label: "平日", days: 13, total: 400, consume: 250, rate: 63, pickups: 30 },
  holiday: { label: "休日・祝", days: 7, total: 600, consume: 560, rate: 85, pickups: 40 },
});

{
  const { els, ChartStub, chartByCanvas } = await runPage("screen.html", {
    "screen-daily.csv": screenDaily,
    "screen-baseline.json": screenBaseline,
  });
  const t = () => els.get("tiles").innerHTML;
  const ds = () => els.get("dayStats").innerHTML;

  assert("scr: content 表示", els.get("content").hidden === false);
  assert("scr: notes=祝日 は休日に分類",
    els.get("dayTitle").textContent === "2026-07-20（休日・祝）", els.get("dayTitle").textContent);
  assert("scr: ヒーロー合計時間",
    els.get("heroNum").innerHTML === "11<small>時間</small>58<small>分</small>",
    els.get("heroNum").innerHTML);
  assert("scr: 休日ベースラインとの差", t().includes("介入前より 1時間58分 多い"), t());
  assert("scr: 非消費 = 合計 − 消費", ds().includes("2時間15分"), ds());
  assert("scr: 消費率タイル", ds().includes("81<small> %</small>"), ds());
  assert("scr: 消費の介入前比は増加で up クラス",
    /class="value up">\+23<small> 分<\/small>/.test(ds()), ds());

  const total = chartByCanvas("totalChart");
  assert("scr: 合計は棒 + 基準線の 2 系列", total.cfg.data.datasets.length === 2);
  assert("scr: 合計系列",
    JSON.stringify(total.cfg.data.datasets[0].data) === "[455,685,529,718]");
  assert("scr: 基準線は平日/休日で切り替わる",
    JSON.stringify(total.cfg.data.datasets[1].data) === "[400,600,600,600]",
    JSON.stringify(total.cfg.data.datasets[1].data));

  const rate = chartByCanvas("rateChart");
  const rateData = rate.cfg.data.datasets[0].data.map((x) => Math.round(x));
  assert("scr: 消費率は折れ線",
    rate.cfg.type === "line" && JSON.stringify(rateData) === "[57,89,77,81]",
    JSON.stringify(rateData));

  const split = chartByCanvas("splitChart");
  assert("scr: 積み上げは消費 + 非消費",
    JSON.stringify(split.cfg.data.datasets[0].data) === "[258,610,406,583]"
    && JSON.stringify(split.cfg.data.datasets[1].data) === "[197,75,123,135]",
    JSON.stringify(split.cfg.data.datasets[1].data));

  const dow = chartByCanvas("dowChart");
  assert("scr: 曜日別平均（記録の無い曜日は null）",
    JSON.stringify(dow.cfg.data.datasets[0].data) === "[529,718,null,null,null,455,685]",
    JSON.stringify(dow.cfg.data.datasets[0].data));

  assert("scr: チャート数（棒3 + 率 + 内訳 + 曜日）",
    ChartStub.created.length === 6, `created=${ChartStub.created.length}`);

  const bl = els.get("blTable").innerHTML;
  assert("scr: ベースライン比較に平日 1 日 / 休日 3 日", bl.includes("1日") && bl.includes("3日"), bl);
  assert("scr: 平日合計の差は増加（up）", /class="up">\+55分/.test(bl), bl);
  assert("scr: 休日消費の差は減少（down）", /class="down">−27分/.test(bl), bl);
  assert("scr: 取り上げの差は回数表記", /class="up">\+3回/.test(bl), bl);

  assert("scr: 期間平均の記録日", els.get("avgs").innerHTML.includes("4 / 4 日"));
  assert("scr: 消費が最も多い日", els.get("avgs").innerHTML.includes("07/18(土) 10時間10分"),
    els.get("avgs").innerHTML);
  assert("scr: テーブルは新しい日が先頭",
    els.get("dataTable").innerHTML.indexOf("2026-07-20") < els.get("dataTable").innerHTML.indexOf("2026-07-17"));
  assert("scr: メモ列に祝日", els.get("dataTable").innerHTML.includes("祝日"));

  // 前日（7/19 日曜）へ
  els.get("prevDay").listeners.click();
  assert("scr: 日曜は休日", els.get("dayTitle").textContent === "2026-07-19（休日・祝）");
  assert("scr: 1回あたり = 合計 / 取り上げ", ds().includes("10<small> 分</small>"), ds());
}

{
  // ベースラインが取れない場合は描画しない（基準が無いと全チャートの意味が変わる）
  const { els } = await runPage("screen.html", { "screen-daily.csv": screenDaily });
  // content は HTML 側で hidden。表示処理に到達していないこと自体を見る
  assert("scr: ベースライン欠落なら content を表示しない",
    !els.has("content") || els.get("content").hidden === true);
  assert("scr: ベースライン欠落を通知",
    els.get("notice").textContent.includes("screen-baseline.json"),
    els.get("notice").textContent);
}

// ---------- 学習ページ ----------

// 学習の記録は「やった日だけ行が増える」ので、7/8 の行を欠いて 0 補完を検証する。
// notes は sa-log-from-comment.sh が書く書式（演習:分野 正答/問数 ／ 学び…）
const kpiCsv = `date,week,study_hours,sessions,am2_25q_attempts,am2_60plus_count,pm1_miss_count,pm2_completed_count,notes
2026-03-08,2026-W10,0,0,0,0,0,0,initial
2026-07-06,2026-W28,1,2,0,0,0,0,演習:ネットワーク 6/10／学びをひとつ書いた
2026-07-07,2026-W28,0.5,1,0,0,0,0,演習:セキュリティ 用語が曖昧 8/10
2026-07-09,2026-W28,2,1,0,0,2,0,演習:ネットワーク 9/10／午後Ⅰの復習`;

// 演習の明細（分野名は転記時に正規化済み）。1 日に複数分野を解いた日は複数行になる
const drillCsv = `date,kind,field,correct,total,minutes,raw
2026-07-06,drill,ネットワーク,6,10,20,ネットワーク
2026-07-07,drill,セキュリティ,8,10,,セキュリティ 用語が曖昧
2026-07-09,drill,ネットワーク,4,5,,ネットワーク 経路制御
2026-07-09,drill,ネットワーク,5,5,,ネットワーク 品質`;

{
  const { els, filterButtons, ChartStub, chartByCanvas, sandbox } = await runPage("study.html",
    { "kpi-tracker.csv": kpiCsv, "drill-log.csv": drillCsv }, { now: "2026-07-10T12:00:00Z" });
  const t = () => els.get("tiles").innerHTML;
  const ws = () => els.get("weekStats").innerHTML;

  // 週番号は kpi-tracker.csv の week 列（sa-log-from-comment.sh が付ける ISO 週）と
  // 一致させる。ずれると補完日と記録日が別の週に落ちて集計が壊れる
  assert("study: ISO 週は CSV の week 列と一致",
    sandbox.isoWeek("2026-07-06") === "2026-W28" && sandbox.isoWeek("2026-07-05") === "2026-W27",
    `${sandbox.isoWeek("2026-07-06")} / ${sandbox.isoWeek("2026-07-05")}`);
  assert("study: 年跨ぎの ISO 週",
    sandbox.isoWeek("2025-12-29") === "2026-W01" && sandbox.isoWeek("2027-01-01") === "2026-W53",
    `${sandbox.isoWeek("2025-12-29")} / ${sandbox.isoWeek("2027-01-01")}`);

  assert("study: content 表示", els.get("content").hidden === false);
  assert("study: 直近の試験（科目A）を出す",
    els.get("examTitle").textContent === "科目A 開始 2026-10-17（CBT・2026-10-27 まで）",
    els.get("examTitle").textContent);
  assert("study: 残り日数", els.get("heroNum").innerHTML === "99<small>日</small>",
    els.get("heroNum").innerHTML);
  assert("study: 今週の目標との差", t().includes("目標まで 30分"), t());
  assert("study: もう一方の試験も出す", t().includes("科目B は 2026-11-11 開始"), t());

  assert("study: 今週の学習時間", ws().includes("3時間30分"), ws());
  assert("study: 学習した日は 7 日中の数", ws().includes("3<small> / 7</small>"), ws());
  // 当日（7/10）はまだ記録が無いだけなので、連続記録を途切れさせない
  assert("study: 連続学習日数", /連続学習<\/div>\s*<div class="value">1<small> 日<\/small>/.test(ws()), ws());
  assert("study: 全期間の正答率（15+8 / 20+10）", ws().includes("77<small> %</small>"), ws());

  const day = chartByCanvas("dayChart");
  assert("study: 記録が無い日は 0 として埋める",
    JSON.stringify(day.cfg.data.datasets[0].data) === "[1,0.5,0,2,0]",
    JSON.stringify(day.cfg.data.datasets[0].data));
  // 分に丸めてから時分に分解する（0.99h を「0時間60分」と出さない）
  const dayTip = day.cfg.options.plugins.tooltip.callbacks.label;
  assert("study: 端数の分は繰り上げて時に送る",
    dayTip({ parsed: { y: 1.995 } }) === " 学習: 2時間"
    && dayTip({ parsed: { y: 0.99 } }) === " 学習: 59分",
    `${dayTip({ parsed: { y: 1.995 } })} / ${dayTip({ parsed: { y: 0.99 } })}`);

  const week = chartByCanvas("weekChart");
  assert("study: 週次は ISO 週で合算",
    JSON.stringify(week.cfg.data.labels) === '["W28"]'
    && JSON.stringify(week.cfg.data.datasets[0].data) === "[3.5]",
    JSON.stringify(week.cfg.data.datasets[0].data));
  assert("study: 週目標 4 時間の点線", week.cfg.data.datasets[1].data.every((y) => y === 4));

  const acc = chartByCanvas("accChart");
  // 7/9 は 4/5 と 5/5 の 2 件。同じ日の演習は合算して 1 点にする
  assert("study: 演習が無い日は点を打たない・同日は合算",
    JSON.stringify(acc.cfg.data.datasets[0].data) === "[60,80,null,90,null]",
    JSON.stringify(acc.cfg.data.datasets[0].data));
  assert("study: 合格ライン 60% の点線",
    acc.cfg.data.datasets[1].data.every((y) => y === 60));

  const cum = chartByCanvas("cumChart");
  assert("study: 累積は単調増加",
    JSON.stringify(cum.cfg.data.datasets[0].data) === "[1,1.5,1.5,3.5,3.5]",
    JSON.stringify(cum.cfg.data.datasets[0].data));
  assert("study: 必要ペースは週 4 時間を日割り",
    cum.cfg.data.datasets[1].data.at(-1) === 2.86,
    JSON.stringify(cum.cfg.data.datasets[1].data));

  const dow = chartByCanvas("dowChart");
  assert("study: 曜日別平均（記録の無い曜日は null）",
    JSON.stringify(dow.cfg.data.datasets[0].data) === "[null,1,0.5,0,2,0,null]",
    JSON.stringify(dow.cfg.data.datasets[0].data));

  const field = chartByCanvas("fieldChart");
  assert("study: 分野は横棒", field.cfg.options.indexAxis === "y");
  assert("study: 分野名は先頭トークン・問数の多い順",
    JSON.stringify(field.cfg.data.labels) === '["ネットワーク","セキュリティ"]',
    JSON.stringify(field.cfg.data.labels));
  assert("study: 分野別正答率",
    JSON.stringify(field.cfg.data.datasets[0].data) === "[75,80]",
    JSON.stringify(field.cfg.data.datasets[0].data));

  assert("study: チャート数（週・日・正答率・累積・曜日・分野）",
    ChartStub.created.length === 6, `created=${ChartStub.created.length}`);

  const notes = els.get("notesList").innerHTML;
  assert("study: メモは新しい日が先頭",
    notes.indexOf("午後Ⅰの復習") < notes.indexOf("学びをひとつ書いた"), notes);
  assert("study: 演習の記録行はメモに出さない", !notes.includes("演習:"), notes);

  const table = els.get("dataTable").innerHTML;
  assert("study: initial 行は行にしない", !table.includes("2026-03-08"), table);
  assert("study: 学習も記録も無い日は表に出さない", !table.includes("2026-07-08"), table);
  assert("study: 演習列は 正答/問数", table.includes("<td>9/10</td>"), table);
  assert("study: 午後Ⅰの外し件数", table.includes("<td>2</td>"), table);

  assert("study: 目標達成週", els.get("avgs").innerHTML.includes("0 / 1 週"),
    els.get("avgs").innerHTML);
  assert("study: 期間合計", els.get("avgs").innerHTML.includes("3時間30分"));

  const before = ChartStub.created.length;
  filterButtons[0].listeners.click();
  assert("study: フィルタ切替で再描画", ChartStub.created.length > before);
  assert("study: aria-pressed 更新", filterButtons[0].attrs["aria-pressed"] === "true");
}

{
  // 演習明細が無くても、学習時間の推移は読めるので描画を続ける
  const { els, chartByCanvas } = await runPage("study.html",
    { "kpi-tracker.csv": kpiCsv }, { now: "2026-07-10T12:00:00Z" });
  assert("study: 明細が欠けても content を表示", els.get("content").hidden === false);
  assert("study: 明細が無ければ正答率は全て null",
    chartByCanvas("accChart").cfg.data.datasets[0].data.every((v) => v === null));
  assert("study: 明細が無ければ分野は空",
    chartByCanvas("fieldChart").cfg.data.labels.length === 0);
  assert("study: 学習時間は明細に依存しない",
    JSON.stringify(chartByCanvas("dayChart").cfg.data.datasets[0].data) === "[1,0.5,0,2,0]");
}

// ---------- 認証画面の表示分岐（共有ブロブ × owner パラメータ） ----------

const dummyBlob = JSON.stringify(
  { v: 1, kdf: "PBKDF2-SHA256", iterations: 600000, salt: "QUFB", iv: "QUFB", ct: "QUFB" });

{
  // 共有ブロブあり + owner パラメータなし → パスワード UI のみ（PAT 設定は非表示）
  const { els } = await runPage("index.html", { "shared-token.json": dummyBlob }, { token: null });
  assert("auth: 閲覧者にはパスワード UI", els.get("pwBlock").hidden === false);
  assert("auth: 閲覧者に PAT 設定は非表示", els.get("patBlock").hidden === true);
}
{
  // 共有ブロブあり + ?owner=1 → PAT 設定も表示
  const { els } = await runPage("index.html", { "shared-token.json": dummyBlob },
    { token: null, search: "?owner=1" });
  assert("auth: 所有者にはパスワード UI + PAT 設定", els.get("pwBlock").hidden === false
    && els.get("patBlock").hidden === false);
}
{
  // 共有ブロブなし → 従来どおり PAT 設定を表示（展開済み）
  const { els } = await runPage("index.html", {}, { token: null });
  assert("auth: ブロブ無しなら PAT 設定を表示", els.get("patBlock").hidden === false
    && els.get("patBlock").open === true);
  assert("auth: ブロブ無しならパスワード UI 非表示", els.get("pwBlock").hidden === true);
}

// ---------- 資産ページ ----------

// フィクスチャの数値はすべて架空。このリポジトリは public なので、
// 実データのコピーは（テスト用であっても）置かない
const dashboardJson = JSON.stringify({
  schema_version: 1,
  generated_at: "2026-07-26T19:45:16",
  date: "2026-07-26",
  basis: "mf",
  summary: {
    total: 12000000, securities_value: 9000000, cost: 7000000, pnl: 2000000,
    pnl_ratio: 0.3, cash: 3000000, liabilities: 500000, net_worth: 11500000,
    priced_count: 12, total_count: 12,
  },
  allocation: [
    { class: "jp_stock", label: "日本株・ETF", value: 6000000, ratio: 0.5,
      target_ratio: 0.4, diff_jpy: -1200000 },
    { class: "fund", label: "投資信託", value: 3000000, ratio: 0.25,
      target_ratio: 0.3, diff_jpy: 600000 },
    { class: "cash", label: "現金・預金", value: 3000000, ratio: 0.25,
      target_ratio: 0.09, diff_jpy: -1920000 },
    { class: "gold", label: "gold", value: 100000, ratio: 0.008,
      target_ratio: null, diff_jpy: null },
  ],
  cashflow: {
    source: "3 ファイル（2024/01〜2026/07）", avg_months: 12,
    avg_expense: 200000, avg_net: 100000,
    emergency_fund_months: 15, emergency_target_months: 6,
    monthly: [
      { month: "2026/04", income: 600000, expense: 120000, net: 480000 },
      { month: "2026/05", income: 500000, expense: 560000, net: -60000 },
      { month: "2026/06", income: 620000, expense: 130000, net: 490000 },
      { month: "2026/07", income: 100000, expense: 40000, net: 60000 },
    ],
    incomplete_month: "2026/07",
  },
  fire: {
    withdrawal_rate: 0.04, expected_return: 0.05,
    annual_expense: 2000000, annual_investment: 1500000,
    target_assets: 50000000, current_assets: 11500000,
    progress: 0.23, remaining: 38500000, years_to_target: 9,
    target_delta_per_10k_monthly: 3000000,
    expense_source: "実測（直近12か月平均）",
    projection: [
      { date: "2027-07-26", value: 13500000, reached: false },
      { date: "2028-07-26", value: 15600000, reached: false },
    ],
  },
  subscriptions: [
    { name: "SAMPLE CLOUD STORAGE", amount: 1000, interval: "monthly",
      monthly_equivalent: 1000, day: 22, occurrences: 6, last_month: "2026/05",
      category: "通信費/情報サービス" },
    { name: "SAMPLE ネンカイヒ", amount: 6000, interval: "yearly",
      monthly_equivalent: 500, day: 4, occurrences: 3, last_month: "2026/05",
      category: "通信費/宅配便・運送" },
  ],
});

// mf = 週次の実測、mf_trend = 資産推移画面からの補完（月末 + 直近の日次）
const historyJsonl = `{"date":"2026-07-26","basis":"mf","total":12000000,"pnl":2000000,"by_class":{"jp_stock":6000000,"us_stock":2000000,"fund":3000000,"cash":1000000}}
{"date":"2026-07-25","basis":"mf_trend","total":11900000,"by_class":{"stock":8000000,"fund":2900000,"cash":1000000}}
{"date":"2026-07-24","basis":"mf_trend","total":11800000,"by_class":{"stock":7900000,"fund":2900000,"cash":1000000}}
{"date":"2026-05-31","basis":"mf_trend","total":11000000,"by_class":{"stock":7500000,"fund":2500000,"cash":1000000}}
{"date":"2026-04-30","basis":"mf_trend","total":10500000,"by_class":{"stock":7000000,"fund":2500000,"cash":1000000}}
壊れた行
`;

{
  const { els, chartByCanvas } = await runPage("finance.html", {
    "dashboard.json": dashboardJson,
    "history.jsonl": historyJsonl,
  });
  const t = () => els.get("tiles").innerHTML;

  assert("fin: content 表示", els.get("content").hidden === false);
  assert("fin: 基準日タイトル", els.get("dayTitle").textContent === "2026-07-26 時点");
  assert("fin: 総資産の桁区切り", els.get("heroNum").innerHTML === "12,000,000",
    els.get("heroNum").innerHTML);
  assert("fin: 評価損益率", t().includes("+30.0%"), t());
  assert("fin: 純資産タイル（万円丸め）", els.get("dayStats").innerHTML.includes("1,150万円"),
    els.get("dayStats").innerHTML);

  const fire = () => els.get("fireCard").innerHTML;
  assert("fin: FIRE 達成率", fire().includes("23.0<small>%</small>"), fire());
  assert("fin: 進捗バーの幅は達成率と一致", fire().includes('width:23.0%'), fire());
  assert("fin: 必要資産と残り", fire().includes("5,000万円") && fire().includes("3,850万円"));
  assert("fin: 到達年の目安", fire().includes("到達の目安 約 9.0 年"));
  assert("fin: 取り崩し率から倍率を導く", fire().includes("年間支出の 25 倍"));
  assert("fin: 支出削減の効き", fire().includes("300万円 下がります"));

  const alloc = chartByCanvas("allocChart");
  assert("fin: 配分はドーナツ", alloc.cfg.type === "doughnut");
  assert("fin: 配分は 4 クラス", alloc.cfg.data.datasets[0].data.length === 4);

  const rebal = chartByCanvas("rebalChart");
  assert("fin: 目標が無いクラスは調整グラフに出さない",
    rebal.cfg.data.datasets[0].data.length === 3);
  assert("fin: 調整は縦棒（ゼロ線を境に上下）", rebal.cfg.options.indexAxis === undefined);
  assert("fin: 資産クラス名を横軸用に詰める",
    JSON.stringify(rebal.cfg.data.labels) === '["日本株","投信","現金"]',
    JSON.stringify(rebal.cfg.data.labels));
  const zeroLine = rebal.cfg.options.scales.y.grid;
  assert("fin: ゼロ線を強調する",
    zeroLine.lineWidth({ tick: { value: 0 } }) > zeroLine.lineWidth({ tick: { value: 1 } }));
  // 色そのものは検証できない（getComputedStyle のスタブが単一値を返すため）。
  // 符号ごとに色を引き分けていることは、データの符号が混在することで担保する
  assert("fin: 調整額は買増と売却が混在",
    rebal.cfg.data.datasets[0].data.some((v) => v > 0)
    && rebal.cfg.data.datasets[0].data.some((v) => v < 0));

  const net = chartByCanvas("netChart");
  assert("fin: 集計途中の月を除く",
    JSON.stringify(net.cfg.data.labels) === '["26/04","26/05","26/06"]',
    JSON.stringify(net.cfg.data.labels));
  assert("fin: 収支の符号で色分け",
    new Set(net.cfg.data.datasets[0].data.map((v) => v >= 0)).size === 2);

  const exp = chartByCanvas("expenseChart");
  assert("fin: 支出に平均線を重ねる",
    exp.cfg.data.datasets.length === 2 && exp.cfg.data.datasets[1].type === "line");
  assert("fin: 平均線は期間平均（270,000）",
    exp.cfg.data.datasets[1].data.every((v) => v === 270000),
    JSON.stringify(exp.cfg.data.datasets[1].data));

  const asset = chartByCanvas("assetChart");
  assert("fin: 推移は折れ線", asset.cfg.type === "line");
  assert("fin: 系列は月末・週次・見通し・必要資産",
    JSON.stringify(asset.cfg.data.datasets.map((d) => d.label))
      === '["月末時点","週次","見通し","必要資産"]',
    JSON.stringify(asset.cfg.data.datasets.map((d) => d.label)));
  const [monthly, daily, projected, targetLine] = asset.cfg.data.datasets;
  const ys = (d) => JSON.stringify(d.data.map((p) => p.y));
  const xs = (d) => d.data.map((p) => p.x);
  assert("fin: 月次系列は境界まで", ys(monthly) === "[10500000,11000000,11800000]", ys(monthly));
  assert("fin: 週次系列は境界から", ys(daily) === "[11800000,11900000,12000000]", ys(daily));
  assert("fin: 境界の点を両系列が共有して線が繋がる",
    xs(monthly).at(-1) === xs(daily)[0] && ys(monthly).includes("11800000"));
  assert("fin: 見通しは最後の実績から繋ぐ",
    ys(projected) === "[12000000,13500000,15600000]", ys(projected));
  assert("fin: 必要資産は水平（2 点とも同値）",
    targetLine.data.length === 2 && targetLine.data.every((p) => p.y === 50000000));
  assert("fin: 必要資産の線は見通しの末尾まで伸ばす",
    targetLine.data.at(-1).x === xs(projected).at(-1));

  // 横軸は時間に比例する（カテゴリ軸だと週次と月次が同じ幅を占めて歪む）
  assert("fin: 横軸は線形の時間軸", asset.cfg.options.scales.x.type === "linear");
  const weekGap = xs(daily)[1] - xs(daily)[0];
  const monthGap = xs(monthly)[1] - xs(monthly)[0];
  assert("fin: 週の間隔は月の間隔より狭い", weekGap < monthGap && weekGap > 0,
    `week=${weekGap} month=${monthGap}`);
  const projGap = xs(projected)[1] - xs(projected)[0];
  assert("fin: 見通しは月間隔", Math.abs(projGap - 12) < 0.1, `gap=${projGap}`);
  const tick = asset.cfg.options.scales.x.ticks.callback;
  assert("fin: 軸ラベルは 1 月なら年、他は年月",
    tick(2027 * 12) === "2027" && tick(2026 * 12 + 6) === "26/07",
    `${tick(2027 * 12)} / ${tick(2026 * 12 + 6)}`);

  // min / max を渡さないと Chart.js は既定の bounds:"ticks" で軸を目盛りの外まで
  // 広げ、左端が観測開始より何か月も前になる
  const xopt = asset.cfg.options.scales.x;
  assert("fin: 横軸の左端は観測開始月の月初",
    xopt.min === Math.floor(xs(monthly)[0]), `${xopt.min} / ${xs(monthly)[0]}`);
  assert("fin: 横軸の右端は見通しの末尾（余白を作らない）",
    xopt.max === xs(projected).at(-1));
  const axis = { ticks: [] };
  xopt.afterBuildTicks(axis);
  const tv = axis.ticks.map((v) => v.value);
  const tickStep = tv[1] - tv[0];
  assert("fin: 目盛りは整数月で等間隔・8 本以内",
    tv.length > 1 && tv.length <= 8 && tv.every((v) => Number.isInteger(v))
    && tv.every((v, i) => i === 0 || v - tv[i - 1] === tickStep), JSON.stringify(tv));
  // 刻みが 12 の約数なら、どの目盛りも「年の区切りから n か月」の位置に乗る
  assert("fin: 目盛りは年初と揃う刻みにする",
    12 % tickStep === 0 && tv.every((v) => v % tickStep === 0),
    `step=${tickStep} ${JSON.stringify(tv)}`);
  assert("fin: 目盛りは軸の範囲内に収まる",
    tv[0] >= xopt.min && tv.at(-1) <= xopt.max, JSON.stringify(tv));
  assert("fin: 見通しは試算だと注記する",
    els.get("assetNote").textContent.includes("断定ではありません"));

  const bd = chartByCanvas("breakdownChart");
  assert("fin: 内訳は積み上げ", bd.cfg.options.scales.y.stacked === true
    && bd.cfg.options.scales.x.stacked === true);
  assert("fin: 内訳も線形の時間軸", bd.cfg.options.scales.x.type === "linear");
  assert("fin: 内訳の横軸も観測開始月の月初から",
    bd.cfg.options.scales.x.min === Math.floor(bd.cfg.data.datasets[0].data[0].x),
    `${bd.cfg.options.scales.x.min}`);
  // 積み上げは下から順に描かれる。安全度の高い資産が下に来ること自体が仕様
  assert("fin: 積み上げは安全度順（下から現金→投信→株式）かつ日米株を合算",
    JSON.stringify(bd.cfg.data.datasets.map((d) => d.label)) === '["現金・預金","投資信託","株式"]',
    JSON.stringify(bd.cfg.data.datasets.map((d) => d.label)));
  const stock = bd.cfg.data.datasets.find((d) => d.label === "株式");
  assert("fin: 実測行の jp+us を合算", stock.data.at(-1).y === 8000000,
    JSON.stringify(stock.data.map((p) => p.y)));
  assert("fin: 内訳の合計は総資産に一致",
    bd.cfg.data.datasets.reduce((a, d) => a + d.data.at(-1).y, 0) === 12000000);

  assert("fin: 生活防衛資金と達成表示",
    els.get("avgs").innerHTML.includes("15.0") && els.get("avgs").innerHTML.includes("目標達成"));
  const subs = els.get("subsTable").innerHTML;
  assert("fin: 年次課金を年次として表示", subs.includes("年次"));
  assert("fin: 月額換算の合計", subs.includes("1,500円"), subs);
  assert("fin: 配分明細に目標無しクラスの − 表示",
    els.get("allocTable").innerHTML.includes("<td>−</td>"));
}

{
  // 日次だけの履歴では系列を分けない（凡例も出さない）
  const { els, chartByCanvas } = await runPage("finance.html", {
    "dashboard.json": dashboardJson,
    "history.jsonl": `{"date":"2026-07-25","basis":"mf","total":11900000}
{"date":"2026-07-26","basis":"mf","total":12000000}
`,
  });
  const asset = chartByCanvas("assetChart");
  const labels = asset.cfg.data.datasets.map((d) => d.label);
  assert("fin: 粒度が単一なら月末系列を作らない", !labels.includes("月末時点"),
    JSON.stringify(labels));
  assert("fin: 粒度が単一でも見通しと必要資産は出す",
    labels.includes("見通し") && labels.includes("必要資産"), JSON.stringify(labels));
  assert("fin: 粒度が単一なら月末の注記を出さない",
    !els.get("assetNote").textContent.includes("月末時点"));
}

{
  // csv 由来（取引明細からの再構成）が混ざる場合だけ、基準の違いを警告する
  const { els } = await runPage("finance.html", {
    "dashboard.json": dashboardJson,
    "history.jsonl": `{"date":"2026-07-01","basis":"csv","total":9000000}
{"date":"2026-07-26","basis":"mf","total":12000000}
`,
  });
  assert("fin: csv が混ざる場合は基準変更を警告",
    els.get("assetNote").textContent.includes("基準が異なる"),
    els.get("assetNote").textContent);
}

{
  // トークン未設定なら認証 UI を出し、データを取りにいかない
  const { els } = await runPage("finance.html", {}, { token: null });
  assert("fin: 未認証で auth 表示", els.get("auth").hidden === false);
  assert("fin: 未認証で content 非表示", els.get("content").hidden === true);
}

// ---------- ページ横断の不変条件 ----------

{
  const idx = readFileSync(join(root, "index.html"), "utf8");
  const act = readFileSync(join(root, "activity.html"), "utf8");
  const scr = readFileSync(join(root, "screen.html"), "utf8");
  const fin = readFileSync(join(root, "finance.html"), "utf8");
  const stu = readFileSync(join(root, "study.html"), "utf8");
  // 資産ページは共有パスワードで開けないため、共有 UI 系の不変条件から除く
  const pages = [["index", idx], ["activity", act], ["screen", scr], ["study", stu]];
  const allPages = [...pages, ["finance", fin]];
  for (const [name, html] of pages) {
    assert(`${name}: 共有パスワード UI`, html.includes('id="pwInput"') && html.includes('id="pwSubmit"'));
    assert(`${name}: 共有トークン生成ツール`, html.includes('id="mkShared"') && html.includes('id="mkOut"'));
    assert(`${name}: shared-token.json を参照`, html.includes("assets/shared-token.json"));
    assert(`${name}: 所有者 UI は ?owner=1 で制御`,
      html.includes('get("owner")') && html.includes('id="patBlock" hidden'));
  }
  // 資産は共有できない: 共有経路が復活しても、このページだけは PAT 必須のまま保つ
  assert("finance: 共有パスワード UI を持たない",
    !fin.includes('id="pwInput"') && !fin.includes('id="pwSubmit"'));
  assert("finance: 共有トークンを参照しない", !fin.includes("shared-token.json"));
  assert("finance: 共有不可を明記", fin.includes("共有パスワードでは開けません"));
  // コピーは FIRE（経済的自立）文脈を保つ。単なる資産一覧に戻さない
  assert("finance: ヒーローのコピー", fin.includes("買い戻す。"));
  assert("finance: 必要資産の考え方を明示", fin.includes("年間支出の 25 倍"));
  for (const [name, html] of allPages) {
    assert(`${name}: PAT の localStorage キー共用`, html.includes('"life_dashboard_pat"'));
    assert(`${name}: ダークモード追従`, html.includes("prefers-color-scheme: dark"));
    assert(`${name}: モーション設定の尊重`, html.includes("prefers-reduced-motion"));
    assert(`${name}: ビルド無し（CDN Chart.js）`, html.includes("cdn.jsdelivr.net/npm/chart.js"));
    assert(`${name}: モバイル幅 720px`, html.includes("max-width: 720px"));
    assert(`${name}: フルスクリーンヒーロー`, html.includes("hero-section"));
    assert(`${name}: 常時ダークバンド`, html.includes("band-dark"));
    assert(`${name}: JS 無効時はステージを縦積み表示`, html.includes(".stagegroup:not(.js)"));
  }
  // このリポジトリは public。個人の実測値・実額は（テスト用でも）置かない — Issue #195
  assert("screen: 介入前ベースラインは private 側から読む",
    scr.includes("screen-baseline.json") && !/weekday:\s*\{\s*label:/.test(scr));
  assert("screen: 説明文にベースラインの実測値を書かない",
    !/介入前（平日\s*\d/.test(scr));
  const fixture = JSON.parse(dashboardJson);
  assert("finance: フィクスチャの金額は丸めた架空値（実データのコピーを禁ずる）",
    Object.entries(fixture.summary)
      .filter(([k]) => !k.endsWith("_ratio") && !k.endsWith("_count"))
      .every(([, v]) => v % 100000 === 0),
    JSON.stringify(fixture.summary));
  // 検索エンジンに載せない（データは PAT 必須だが URL も出さない）
  const robots = readFileSync(join(root, "robots.txt"), "utf8");
  assert("robots.txt で全体を Disallow",
    /User-agent:\s*\*/.test(robots) && /Disallow:\s*\/\s*$/m.test(robots), robots);
  for (const [name, html] of allPages) {
    assert(`${name}: noindex メタ`, /<meta name="robots" content="noindex/.test(html));
  }

  // 表示用語の統一: 同じものを一つの名前で呼ぶ（テーブルだけ略すと迷子になる）
  assert("screen: 「取り上げ」の表記ゆれが無い", !scr.includes("取上"));
  // 検査対象は <body> のマークアップのみ（CSS / JS のコメントは表示されない）
  const scrMarkup = scr.split("</style>")[1].split('<script>\n"use strict"')[0];
  assert("screen: UI 文言は「介入前」に統一（ベースラインはコード側の語）",
    !scrMarkup.includes("ベースライン"));

  // 全ページが相互にリンクしていること（トップバーのナビ）
  for (const [name, html] of allPages) {
    for (const href of ["index.html", "activity.html", "screen.html", "study.html", "finance.html"]) {
      assert(`${name}: ナビに ${href}`, html.includes(`<a href="${href}"`));
    }
  }
  // スクロール駆動ステージ: タブ数とパネル数が一致すること
  for (const [name, html, groups] of [["index", idx, [4]], ["activity", act, [4, 2, 3]],
                                      ["screen", scr, [4, 2]], ["study", stu, [4, 2]],
                                      ["finance", fin, [2, 2, 2]]]) {
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
    "assets/hero/screen-hero.webp": 250_000,
    "assets/hero/finance-hero.webp": 250_000,
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
  for (const [name, html] of allPages) {
    assert(`${name}: favicon リンク`, html.includes("assets/icon/favicon-32.png"));
    assert(`${name}: apple-touch-icon`, html.includes("assets/icon/apple-touch-icon.png"));
    assert(`${name}: manifest リンク`, html.includes('rel="manifest"'));
    assert(`${name}: OG 画像メタ`, html.includes("assets/og/og-image.jpg"));
  }
  assert("index: ヒーロー背景画像", idx.includes("assets/hero/sleep-hero.webp"));
  assert("activity: ヒーロー背景画像", act.includes("assets/hero/activity-hero.webp"));
  assert("screen: ヒーロー背景画像", scr.includes("assets/hero/screen-hero.webp"));
  assert("finance: ヒーロー背景画像", fin.includes("assets/hero/finance-hero.webp"));
  assert("finance: 他ページのヒーロー画像を流用しない",
    !/assets\/hero\/(sleep|activity|screen)-hero\.webp/.test(fin));
  // 学習ページは専用のヒーロー画像を持たない（グラデーションで代用）。
  // 用意できるまで他ページの画像を流用しない
  assert("study: ヒーローはグラデーション", stu.includes("linear-gradient(165deg"));
  assert("study: 他ページのヒーロー画像を流用しない", !/assets\/hero\//.test(stu));
  // 目標値と試験日程はページ内の固定値（実測データではない）
  assert("study: 週 4 時間のコア目標", stu.includes("WEEKLY_GOAL_H = 4"));
  assert("study: 試験は科目 A / B の 2 段階", /key: "a"[\s\S]*key: "b"/.test(stu));

  // 各ステージパネルは説明カラム（stagedesc + desc 本文）とグラフカラム（stagefig）を持つ
  for (const [name, html, total] of [["index", idx, 4], ["activity", act, 9],
                                     ["screen", scr, 6], ["study", stu, 6],
                                     ["finance", fin, 6]]) {
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
