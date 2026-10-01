export const QUESTION_COUNT = 10;

export type ProblemRecord = {
  term: string;
  explanation: string;
};

export type Choice = {
  text: string;
  correct: boolean;
};

export type Question = {
  term: string;
  correctExplanation: string;
  choices: Choice[];
};

export type Score = {
  correct: number;
  limitMs: number;
  at: string;
};

function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function problemSetTitle(text: string, file: string): string {
  const source = withoutBom(text);
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("#")) break;
    const match = /^#\s*title:\s*(.+)$/i.exec(trimmed);
    const title = match?.[1]?.trim();
    if (title) return title;
  }
  return file.replace(/\.txt$/i, "");
}

export function parseProblems(text: string): ProblemRecord[] {
  const source = withoutBom(text);
  const records: ProblemRecord[] = [];
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

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as T;
    out[j] = tmp as T;
  }
  return out;
}

export function buildQuiz(
  records: readonly ProblemRecord[],
  count = QUESTION_COUNT,
  random: () => number = Math.random,
): Question[] {
  const usable = records.filter((record) => record.term && record.explanation);
  const explanations = new Set(usable.map((record) => record.explanation));
  if (explanations.size < 2) {
    throw new Error("誤答を作るには、説明が異なるレコードが2件以上必要です");
  }

  const order = shuffle(usable, random);
  const questions: Question[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = order[i % order.length];
    if (!item) continue;
    const wrongPool = usable.filter((record) => record.explanation !== item.explanation);
    const wrong = wrongPool[Math.floor(random() * wrongPool.length)];
    if (!wrong) continue;
    const pair: Choice[] = [
      { text: item.explanation, correct: true },
      { text: wrong.explanation, correct: false },
    ];
    const choices = random() < 0.5 ? pair : [pair[1] as Choice, pair[0] as Choice];
    questions.push({
      term: item.term,
      correctExplanation: item.explanation,
      choices,
    });
  }
  return questions;
}

export function isBetterScore(next: Score, prev: Score | null): boolean {
  if (!prev) return true;
  if (next.correct !== prev.correct) return next.correct > prev.correct;
  if (next.limitMs !== prev.limitMs) return next.limitMs < prev.limitMs;
  return false;
}

export function clampLimitSec(value: unknown): number {
  const n = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(0.1, n));
}

export function isSafeProblemFile(file: string): boolean {
  return (
    file.length > 4 &&
    file.length < 200 &&
    file.endsWith(".txt") &&
    !file.includes("/") &&
    !file.includes("\\") &&
    !file.includes("..")
  );
}
