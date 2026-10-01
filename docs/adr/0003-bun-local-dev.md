# 0003. ローカルの Bun サーバーで TypeScript を動かす

Date: 2026-10-01
Status: Accepted（回答ログの保存先は ADR-0004 で `data/log.jsonl` に変更）

## Context

単語学習アプリは GitHub Pages 向けの素の HTML / JS だった。これからはローカルで `bun run dev` により動かし、実装は TypeScript と Bun にする。外部ライブラリはできるだけ使わない。問題ファイルは引き続き `data/` に置く。

## Decision

- 開発サーバーは `Bun.serve`。起動コマンドは `bun run dev`。
- 出題ロジックは `src/quiz.ts`。画面は TypeScript で書き、ブラウザへ渡すときは Bun 同梱の `Bun.build` で束ねる。npm の依存は置かない。
- 問題セット一覧はサーバーが `data/*.txt` を読む。表示名はファイル先頭の `# title:` 、なければ拡張子を除いたファイル名。`sets.json` は使わない。
- ハイスコアと制限時間はブラウザの `localStorage` に残す。回答ログは当初ここへ置くとしていたが、ADR-0004 で `data/log.jsonl` に変えた。
- `.gitignore` の `data/` はそのまま。サーバーは無視されているファイルもディスクから読む。

## Consequences

- 実行には Bun が必要になり、GitHub Pages への静的配置はやめる。
- `data/` にテキストを置いて再読み込みすれば問題セットが増える。コミットしなくてもローカルでは使える。
- ADR-0001 の配信方式と実装言語は、この ADR で置き換える。正誤のルールと `data/` の gitignore（ADR-0002）は維持する。
