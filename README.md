# life-dashboard

private リポジトリ [LIFE](https://github.com/mat-dev-io/LIFE) のデータを表示する
静的ダッシュボードのシェル（GitHub Pages 用の公開リポジトリ）。

- **このリポジトリに個人データは含まれない**。ページは閲覧者の端末に保存された
  Fine-grained PAT（LIFE / Contents: Read-only のみ）で GitHub API から直接データを読む
- 睡眠ダッシュボード: <https://mat-dev-io.github.io/life-dashboard/>
  （ソース: `index.html`、データ仕様は LIFE 側 `docs/ops/ios-shortcut-sleep-log.md` を参照）
- アクティビティダッシュボード: <https://mat-dev-io.github.io/life-dashboard/activity.html>
  （ソース: `activity.html`。歩数・アクティブエネルギー・エクササイズ・スタンド・安静時心拍・
  心拍変動を表示。データ仕様は LIFE 側 `docs/ops/ios-shortcut-health-metrics-log.md` を参照）
- スクリーンタイムダッシュボード: <https://mat-dev-io.github.io/life-dashboard/screen.html>
  （ソース: `screen.html`。合計・消費・消費率・取り上げ回数を、介入前ベースライン
  （2026-07-01〜07-20 の固定値。平日 379 分 / 休日 638 分ほか）と比較して表示。
  平日と休日は必ず分けて集計する。データ仕様は LIFE 側 `docs/ops/screen-time-log.md` を参照）

## 共有閲覧（パスワード方式）

PAT を持たない相手にも、共有パスワードだけで閲覧してもらえる。
仕組み: 共有専用の読み取り PAT を AES-GCM（鍵は PBKDF2-SHA256 60 万回で
パスワードから導出）で暗号化した JSON を `assets/shared-token.json` として公開する。
復号は閲覧者のブラウザ内で行われ、パスワードも PAT も送信されない。

### 所有者の手順（初回）

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
