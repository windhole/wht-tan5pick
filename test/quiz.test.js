import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuiz,
  clampLimitSec,
  isBetterScore,
  parseProblems,
} from "../js/quiz.js";

test("タブ区切りの問題を読み、コメントと空行を捨てる", () => {
  const records = parseProblems("# comment\n\nAPI\t窓口\nCPU\t処理装置\n");
  assert.deepEqual(records, [
    { term: "API", explanation: "窓口" },
    { term: "CPU", explanation: "処理装置" },
  ]);
});

test("タブがない行や片側が空の行は無視する", () => {
  const records = parseProblems("no tab\n\t説明だけ\n用語だけ\t\nOK\t説明\n");
  assert.deepEqual(records, [{ term: "OK", explanation: "説明" }]);
});

test("BOM と CRLF を扱える", () => {
  const records = parseProblems("\uFEFFA\t1\r\nB\t2\r\n");
  assert.equal(records.length, 2);
  assert.equal(records[0].term, "A");
});

test("10問を作り、各問の選択肢は正解1つと別レコードの説明", () => {
  const records = Array.from({ length: 12 }, (_, i) => ({
    term: `T${i}`,
    explanation: `E${i}`,
  }));
  const quiz = buildQuiz(records, 10, () => 0.4);
  assert.equal(quiz.length, 10);
  for (const question of quiz) {
    assert.equal(question.choices.length, 2);
    const correct = question.choices.filter((choice) => choice.correct);
    assert.equal(correct.length, 1);
    assert.equal(correct[0].text, question.correctExplanation);
    const wrong = question.choices.find((choice) => !choice.correct);
    assert.notEqual(wrong.text, question.correctExplanation);
  }
});

test("説明が1種類しかないと誤答を作れない", () => {
  assert.throws(() =>
    buildQuiz([
      { term: "A", explanation: "同じ" },
      { term: "B", explanation: "同じ" },
    ]),
  );
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
  assert.equal(quiz.length, 10);
});

test("ハイスコアは正解数優先、同点なら制限時間が短い方", () => {
  assert.equal(isBetterScore({ correct: 0, limitMs: 1000 }, null), true);
  assert.equal(
    isBetterScore({ correct: 5, limitMs: 1000 }, { correct: 8, limitMs: 1000 }),
    false,
  );
  assert.equal(
    isBetterScore({ correct: 8, limitMs: 500 }, { correct: 8, limitMs: 1000 }),
    true,
  );
  assert.equal(
    isBetterScore({ correct: 8, limitMs: 2000 }, { correct: 8, limitMs: 1000 }),
    false,
  );
});

test("制限時間は0.1秒から10秒", () => {
  assert.equal(clampLimitSec(0), 0.1);
  assert.equal(clampLimitSec(10.04), 10);
  assert.equal(clampLimitSec(1.26), 1.3);
  assert.equal(clampLimitSec("nope"), 1);
});
