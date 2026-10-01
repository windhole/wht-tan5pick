import { expect, test } from "bun:test";
import { formatLogLine, parseLogEntry, parseLogFile } from "../src/log.ts";

const sample = {
  sessionId: "abc",
  at: "2026-10-01T04:00:00.000Z",
  setId: "it-basics",
  setTitle: "IT基礎用語",
  index: 1,
  term: "API",
  correctExplanation: "窓口",
  choices: ["窓口", "処理装置"],
  selected: "窓口",
  outcome: "correct",
  limitMs: 1000,
  elapsedMs: 400,
};

test("妥当な回答を1行の JSON にして読み戻す", () => {
  const text = formatLogLine(sample);
  expect(text.endsWith("\n")).toBe(true);
  expect(parseLogFile(`${text}\n壊れた行\n`)).toEqual([
    { ...sample, choices: ["窓口", "処理装置"] },
  ]);
});

test("時間切れは選択なし、不正解は選択あり", () => {
  expect(
    parseLogEntry({ ...sample, outcome: "timeout", selected: null, elapsedMs: 1000 }),
  ).not.toBeNull();
  expect(parseLogEntry({ ...sample, outcome: "timeout", selected: "窓口" })).toBeNull();
  expect(parseLogEntry({ ...sample, outcome: "incorrect", selected: null })).toBeNull();
});

test("問番号と制限時間の範囲外は捨てる", () => {
  expect(parseLogEntry({ ...sample, index: 11 })).toBeNull();
  expect(parseLogEntry({ ...sample, limitMs: 50 })).toBeNull();
  expect(parseLogEntry({ ...sample, elapsedMs: 5000 })).toBeNull();
});
