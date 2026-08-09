# life-dashboard

private リポジトリ [LIFE](https://github.com/mat-dev-io/LIFE) のデータを表示する
静的ダッシュボードのシェル（GitHub Pages 用の公開リポジトリ）。

- **このリポジトリに個人データは含まれない**。ページは閲覧者の端末に保存された
  Fine-grained PAT（LIFE / Contents: Read-only のみ）で GitHub API から直接データを読む
  - この不変条件は**テスト用フィクスチャにも適用する**。実データをコピーして貼らず、
    丸めた架空値を使う（`test/harness.mjs` が summary の桁を回帰チェックしている）
  - 検索エンジンには載せない方針。`robots.txt`（Disallow: /）と各ページの
    `<meta name="robots" content="noindex, nofollow">` を置く
- 睡眠ダッシュボード: <https://mat-dev-io.github.io/life-dashboard/>
  （ソース: `index.html`、データ仕様は LIFE 側 `docs/ops/ios-shortcut-sleep-log.md` を参照）
- アクティビティダッシュボード: <https://mat-dev-io.github.io/life-dashboard/activity.html>
  （ソース: `activity.html`。歩数・アクティブエネルギー・エクササイズ・スタンド・安静時心拍・
  心拍変動・体組成を表示。データ仕様は LIFE 側 `docs/ops/ios-shortcut-health-metrics-log.md` を参照）
  - 体組成（体重・体脂肪率・除脂肪体重）は**7 日移動平均の線を主役**にし、単日の実測は薄い点で
    添えるだけにする。日内変動が 1kg 前後あるため、単日の値と前日比では判定しない
  - 窓のサンプルが 3 点未満の日は線を引かない。計測を始めた直後は実測点だけが出て、
    データが溜まるにつれて線が伸びる
  - 除脂肪体重は体重と体脂肪率が両方そろった日だけ導出する（LIFE 側 `/health-check` と同じ規則）
  - 目標バンドは LIFE 側 `data/health/body-goals.json` を PAT 経由で読む。**public 側に目標値を
    持たない**（実測ベースライン由来の値であり、判定基準を二重定義しないため）。読めなかった
    場合は基準線を出さずに推移だけを描く
  - Y 軸のレンジは明示指定する。Chart.js の linear 軸は既定 `bounds:"ticks"` で目盛りの外まで
    軸を広げるうえ、体組成は変動幅が小さいので、放置すると測定ノイズが山脈のように見える
- スクリーンタイムダッシュボード: <https://mat-dev-io.github.io/life-dashboard/screen.html>
  （ソース: `screen.html`。合計・消費・消費率・取り上げ回数を、介入前ベースラインと
  比較して表示。ベースラインは実測値のため public 側には置かず、日次データと同じく
  LIFE 側 `data/health/screen-baseline.json` を PAT 経由で読む（欠けたら描画しない）。
  平日と休日は必ず分けて集計する。データ仕様は LIFE 側 `docs/ops/screen-time-log.md` を参照）
- 学習ダッシュボード: <https://mat-dev-io.github.io/life-dashboard/study.html>
  （ソース: `study.html`。システムアーキテクト試験までの残り日数・週の学習時間と目標 4 時間・
  演習の正答率・累積と必要ペース・曜日別・分野別・学びメモを表示。データは LIFE 側
  `data/study/system-architect/kpi-tracker.csv`（日次の集計）と同 `drill-log.csv`
  （演習 1 件 1 行の明細）を読む。どちらも Issue #7 への `log` コメントを
  `scripts/sa-log-from-comment.sh` が転記して生成する）
  - **記録が無い日は欠測ではなく 0 時間**として埋める。学習ログは「やった日だけ行が増える」
    記録なので、行の不在は「やらなかった」を意味する。曜日別平均も 0 の日を含めて割る
  - 週番号は CSV の `week` 列（ISO 週）と同じ規則で補完日にも付ける。ずれると補完日と
    記録日が別の週に落ちて週次集計が壊れる（`test/harness.mjs` が回帰チェック）
  - 分野別の正答率は `drill-log.csv` を正本とする（`kpi-tracker.csv` は日単位の集計なので、
    1 日に複数分野を解いた日を分解できない）。分野名の表記ゆれは転記時に正規化済みなので、
    ページ側では束ねるだけ。**明細が取れなくても時間の推移は描く**（正答率と分野だけ空になる）
  - `notes` の「演習:…」はメモ一覧に出さない（明細と二重に見えるため）。書式が崩れて明細へ
    入らなかった演習は、詳細テーブルの演習列が空になることで気づける
  - 試験日程と週 4 時間のコア目標はページ内の固定値。実測値ではないので public 側に置く
  - 専用のヒーロー画像は未作成で、グラデーション（夜明け前の紫→青）で代用している
- 資産ダッシュボード: <https://mat-dev-io.github.io/life-dashboard/finance.html>
  （ソース: `finance.html`。**経済的自立（FIRE）の進捗**・総資産・資産配分と目標との差・
  月次収支・月間支出・資産推移・生活防衛資金・定期課金を表示。データは LIFE 側
  `data/finance/dashboard.json` と `data/finance/history.jsonl`
  （`scripts/finance-report.sh` が生成）を読む）
  - コピーは FIRE 文脈（「時間を、買い戻す。」）で統一している。単なる資産一覧の文言に
    戻さないこと。`test/harness.mjs` がヒーローのコピーと「年間支出の 25 倍」の記述を
    回帰チェックしている
  - ヒーローは `assets/hero/finance-hero.webp`（下から立ち上がる光 = 積み上げと夜明け）
  - **資産推移は FIRE 進捗のすぐ下**に置く（進捗と推移は同じ問いの表と裏のため）。
    「総資産と見通し」「内訳」の 2 ステージ構成
  - 記録の粒度は途中で変わる（過去は各月末のみ、直近は週次）。点の間隔が 20 日以上
    空く区間を月次とみなし、**破線の「月末時点」と実線の「週次」に分けて描く**。
    境界の点は両系列に含めて線を繋ぐ。軸ラベルも月次は年月・週次は月日で出し分ける
  - 実績の先に **FIRE 到達までの見通し（点線）と必要資産（水平線）** を重ねる。
    見通しは最後の実績から繋ぎ、試算である旨を注記に出す
  - **横軸は「起点からの月数」を値に持つ線形軸**（`monthPos()`）。カテゴリ軸だと
    週次の点と月次の点が同じ幅を占め、時間が歪んで見通しの傾きも実際と変わる。
    目盛りは 1 月なら年、他は年月で表示する（`monthLabel()`）
  - 内訳は資産クラス別の積み上げ。出所によってクラスの粒度が違う（補完行は株式を
    日米合算、実測行は分けて持つ）ため、`jp_stock` / `us_stock` を `stock` に寄せて揃える
  - **積み上げ順は下から 現金・預金 → 投資信託 → 株式 → 暗号資産 → FX**（`CLASS_ORDER`）。
    安全度の高い資産を下に置き、土台がどれだけ厚いかを読み取れるようにする

### 資産ページは共有できない

`finance.html` は**共有パスワードでは開けない**。共有パスワード UI を持たず、
`assets/shared-token.json` も参照しないため、共有閲覧を再開しても資産情報は
所有者の PAT を保存した端末でしか表示されない。この不変条件は
`test/harness.mjs` が回帰チェックしている（共有 UI が混入したら FAIL）。

なお資産ページ専用のヒーロー画像は未作成で、当面はグラデーションで代用している。
用意する場合は `assets/hero/finance-hero.webp` として `assets/README.md` の仕様に
合わせて配置し、`.hero-section` の `background` を差し替える。

## 共有閲覧（パスワード方式）— 現在は無効

**2026-07-25 以降、共有閲覧は停止している**（所有者のみ閲覧する運用）。
`assets/shared-token.json` は削除済みで、共有専用 PAT も Revoke 済み。
この状態では PAT 設定 UI が `?owner=1` 無しでも表示され、端末に保存した
自分の PAT だけでデータを読む。以下は再開したくなったときの手順。

仕組み: 共有専用の読み取り PAT を AES-GCM（鍵は PBKDF2-SHA256 60 万回で
パスワードから導出）で暗号化した JSON を `assets/shared-token.json` として公開する。
復号は閲覧者のブラウザ内で行われ、パスワードも PAT も送信されない。

### 所有者の手順（再開するとき）

1. 共有専用の Fine-grained PAT を**新規発行**する（LIFE のみ / Contents: Read-only /
   有効期限を設定。自分用と分けることで単独で失効できる）
2. ダッシュボードを **`?owner=1` 付き URL** で開き（例:
   `https://mat-dev-io.github.io/life-dashboard/?owner=1`）、
   「PAT で設定する（所有者向け）」→「共有用トークンの作成」に
   その PAT とパスワードを入れ、「暗号化 JSON を生成」
   ※ `shared-token.json` 設置後、PAT 設定 UI は `?owner=1` のときだけ表示される
   （表示の整理であり秘匿ではない。アクセス制御は GitHub API 側で行われる）
3. 出力された JSON を `assets/shared-token.json` としてコミットする
4. 閲覧者には URL とパスワードを伝えるだけ

### セキュリティ上の注意

- 暗号化 JSON は**公開される**ため、オフライン総当たりが可能。パスワードは
  **ランダムな単語 4 つ以上のパスフレーズ**（例: `correct-horse-battery-staple` 形式）にすること
- 共有を止めるとき: GitHub で共有専用 PAT を Revoke し、`assets/shared-token.json` を削除
- パスワード変更: 新しいパスワードで JSON を再生成してコミットし直す

## 検証

ブラウザ無しでロジックを end-to-end 検証できるハーネスを同梱している
（DOM / fetch / Chart.js をスタブし、CSV 統合・欠測 null 化・移動平均・描画文字列を確認）:

```bash
node test/harness.mjs
```
