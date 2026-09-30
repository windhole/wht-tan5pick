# 0002. data/ は gitignore に戻す

Date: 2026-10-01
Status: Accepted

## Context

ADR-0001 は、問題ファイルを GitHub Pages に載せるため `.gitignore` の `data/` を外した。いっぽう `data/` 除外はこのリポジトリの既存ルールで、個人用の問題セットを誤ってコミットしないためのものだった。

## Decision

- `.gitignore` に `data/` を戻す。
- すでに追跡しているサンプル（`data/sets.json` と各 `.txt`）はそのままリポジトリに残し、Pages が配信する問題セットとする。
- 新しく置いた問題ファイルは無視される。公開するファイルだけ `git add -f` する。追跡済みの `sets.json` の編集は通常どおりコミットする。

## Consequences

- ローカルだけの問題セットは push されない。
- 公開したい問題は、force add を忘れると Pages 上で一覧にあっても読めない。
- ADR-0001 の「`data/` 除外を外す」だけを取り消す。配信方法そのものは ADR-0001 のまま。
