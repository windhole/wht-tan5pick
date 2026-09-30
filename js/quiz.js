export const QUESTION_COUNT = 10;

export function parseProblems(text) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const term = line.slice(0, tab).trim();
    const explanation = line.slice(tab + 1).trim();
    if (!term || !explanation) continue;
    records.push({ term, explanation });
  }
  return records;
}

export function shuffle(items, random = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function buildQuiz(records, count = QUESTION_COUNT, random = Math.random) {
  const usable = records.filter((record) => record.term && record.explanation);
  const explanations = new Set(usable.map((record) => record.explanation));
  if (explanations.size < 2) {
    throw new Error("誤答を作るには、説明が異なるレコードが2件以上必要です");
  }

  const order = shuffle(usable, random);
  const questions = [];
  for (let i = 0; i < count; i += 1) {
    const item = order[i % order.length];
    const wrongPool = usable.filter((record) => record.explanation !== item.explanation);
    const wrong = wrongPool[Math.floor(random() * wrongPool.length)];
    const pair = [
      { text: item.explanation, correct: true },
      { text: wrong.explanation, correct: false },
    ];
    const choices = random() < 0.5 ? pair : [pair[1], pair[0]];
    questions.push({
      term: item.term,
      correctExplanation: item.explanation,
      choices,
    });
  }
  return questions;
}

export function isBetterScore(next, prev) {
  if (!prev) return true;
  if (next.correct !== prev.correct) return next.correct > prev.correct;
  if (next.limitMs !== prev.limitMs) return next.limitMs < prev.limitMs;
  return false;
}

export function clampLimitSec(value) {
  const n = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(0.1, n));
}
