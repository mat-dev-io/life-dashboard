# life-dashboard

private リポジトリ [LIFE](https://github.com/mat-dev-io/LIFE) のデータを表示する
静的ダッシュボードのシェル（GitHub Pages 用の公開リポジトリ）。

- **このリポジトリに個人データは含まれない**。ページは閲覧者の端末に保存された
  Fine-grained PAT（LIFE / Contents: Read-only のみ）で GitHub API から直接データを読む
- 睡眠ダッシュボード: <https://mat-dev-io.github.io/life-dashboard/>
  （ソース: `index.html`、データ仕様は LIFE 側 `docs/ops/ios-shortcut-sleep-log.md` を参照）
- アクティビティダッシュボード: <https://mat-dev-io.github.io/life-dashboard/activity.html>
  （ソース: `activity.html`。歩数・アクティブエネルギー・エクササイズ・スタンド・安静時心拍・
  ワークアウトを表示。データ仕様は LIFE 側 `docs/ops/ios-shortcut-health-metrics-log.md` を参照）
