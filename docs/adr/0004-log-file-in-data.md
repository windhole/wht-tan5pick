# 0004. 回答ログは data/log.jsonl に追記する

Date: 2026-10-01
Status: Accepted

## Context

回答と正誤はブラウザの `localStorage` に蓄積していた。ログを `data/` のファイルとして残し、端末のブラウザを消しても記録が残るようにする。問題セットも同じフォルダにある。

## Decision

- ログの実体は `data/log.jsonl`。1回答が1行の JSON で、サーバーが末尾へ追記する。
- 画面は `GET /api/logs` で読み、回答のたびに `POST /api/logs` で1件送る。
- 拡張子は `.txt` にしない。問題セットの走査は `*.txt` だけなので、ログは出題されない。
- ハイスコアと制限時間は `localStorage` のままにする。

## Consequences

- ログは `data/` の gitignore に含まれ、リポジトリには入らない。
- ブラウザを変えても、同じマシンで `bun run dev` していれば同じログを見られる。
- ADR-0003 の「回答ログは localStorage」は、この ADR で置き換える。
