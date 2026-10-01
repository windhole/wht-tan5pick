import { expect, test } from "bun:test";
import {
  buildQuiz,
  clampLimitSec,
  isBetterScore,
  parseProblems,
  problemSetTitle,
} from "../src/quiz.ts";

test("タブ区切りの問題を読み、コメントと空行を捨てる", () => {
  const records = parseProblems("# comment\n\nAPI\t窓口\nCPU\t処理装置\n");
  expect(records).toEqual([
    { term: "API", explanation: "窓口" },
    { term: "CPU", explanation: "処理装置" },
  ]);
});

test("タブがない行や片側が空の行は無視する", () => {
  const records = parseProblems("no tab\n\t説明だけ\n用語だけ\t\nOK\t説明\n");
  expect(records).toEqual([{ term: "OK", explanation: "説明" }]);
});

test("BOM と CRLF を扱える", () => {
  const records = parseProblems("\uFEFFA\t1\r\nB\t2\r\n");
  expect(records).toHaveLength(2);
  expect(records[0]?.term).toBe("A");
});

test("表示名は # title: を使い、無ければファイル名", () => {
  expect(problemSetTitle("# title: IT基礎用語\nAPI\t窓口\n", "it-basics.txt")).toBe("IT基礎用語");
  expect(problemSetTitle("# comment\nAPI\t窓口\n", "it-basics.txt")).toBe("it-basics");
});

test("10問を作り、各問の選択肢は正解1つと別レコードの説明", () => {
  const records = Array.from({ length: 12 }, (_, i) => ({
    term: `T${i}`,
    explanation: `E${i}`,
  }));
  const quiz = buildQuiz(records, 10, () => 0.4);
  expect(quiz).toHaveLength(10);
  for (const question of quiz) {
    expect(question.choices).toHaveLength(2);
    const correct = question.choices.filter((choice) => choice.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0]?.text).toBe(question.correctExplanation);
    const wrong = question.choices.find((choice) => !choice.correct);
    expect(wrong?.text).not.toBe(question.correctExplanation);
  }
});

test("説明が1種類しかないと誤答を作れない", () => {
  expect(() =>
    buildQuiz([
      { term: "A", explanation: "同じ" },
      { term: "B", explanation: "同じ" },
    ]),
  ).toThrow();
});

test("レコードが10件未満でも10問出る", () => {
  const quiz = buildQuiz(
    [
      { term: "A", explanation: "1" },
      { term: "B", explanation: "2" },
    ],
    10,
    () => 0,
  );
  expect(quiz).toHaveLength(10);
});

test("ハイスコアは正解数優先、同点なら制限時間が短い方", () => {
  expect(isBetterScore({ correct: 0, limitMs: 1000, at: "" }, null)).toBe(true);
  expect(
    isBetterScore(
      { correct: 5, limitMs: 1000, at: "" },
      { correct: 8, limitMs: 1000, at: "" },
    ),
  ).toBe(false);
  expect(
    isBetterScore(
      { correct: 8, limitMs: 500, at: "" },
      { correct: 8, limitMs: 1000, at: "" },
    ),
  ).toBe(true);
  expect(
    isBetterScore(
      { correct: 8, limitMs: 2000, at: "" },
      { correct: 8, limitMs: 1000, at: "" },
    ),
  ).toBe(false);
});

test("制限時間は0.1秒から10秒", () => {
  expect(clampLimitSec(0)).toBe(0.1);
  expect(clampLimitSec(10.04)).toBe(10);
  expect(clampLimitSec(1.26)).toBe(1.3);
  expect(clampLimitSec("nope")).toBe(1);
});
