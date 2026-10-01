import { parseLogEntry, type LogEntry, type Outcome } from "../log.ts";
import {
  QUESTION_COUNT,
  buildQuiz,
  clampLimitSec,
  isBetterScore,
  isSafeProblemFile,
  parseProblems,
  type Choice,
  type Question,
  type Score,
} from "../quiz.ts";

type ProblemSet = {
  id: string;
  title: string;
  file: string;
};

type Settings = {
  setId: string | null;
  limitSec: number;
};

const KEYS = {
  settings: "tan5pick.settings.v1",
  scores: "tan5pick.highscores.v1",
};

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} がありません`);
  return node;
}

const cache = new Map<string, ReturnType<typeof parseProblems>>();
const state = {
  sets: [] as ProblemSet[],
  starting: false,
  playing: false,
  locked: false,
  presentedAt: 0,
  set: null as ProblemSet | null,
  questions: [] as Question[],
  session: [] as LogEntry[],
  sessionId: "",
  index: 0,
  limitMs: 1000,
  startedAt: 0,
  raf: 0,
  timerId: 0,
  logSaveFailed: false,
};

let logs: LogEntry[] = [];
let scores = loadScores();

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadScores(): Record<string, Score> {
  const raw = readJson(KEYS.scores);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, Score>;
}

async function fetchLogs(): Promise<LogEntry[]> {
  try {
    const response = await fetch("/api/logs");
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const entry = parseLogEntry(item);
      return entry ? [entry] : [];
    });
  } catch {
    return [];
  }
}

async function postLog(entry: LogEntry): Promise<boolean> {
  try {
    const response = await fetch("/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function show(name: string): void {
  for (const id of ["open", "play", "result", "log"]) {
    $(`screen-${id}`).hidden = id !== name;
  }
}

function setMessage(text: string): void {
  const el = $("open-message");
  el.hidden = !text;
  el.textContent = text;
}

function formatSec(sec: number): string {
  return `${clampLimitSec(sec).toFixed(1)}秒`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function limitInput(): HTMLInputElement {
  return $("limit-range") as HTMLInputElement;
}

function setSelect(): HTMLSelectElement {
  return $("set-select") as HTMLSelectElement;
}

function currentSet(): ProblemSet | null {
  return state.sets.find((set) => set.id === setSelect().value) ?? null;
}

function persistSettings(): Settings {
  const settings: Settings = {
    setId: setSelect().value || null,
    limitSec: clampLimitSec(limitInput().value),
  };
  limitInput().value = String(settings.limitSec);
  $("limit-output").textContent = formatSec(settings.limitSec);
  writeJson(KEYS.settings, settings);
  return settings;
}

function renderHighScore(): void {
  const set = currentSet();
  const score = set ? scores[set.id] : null;
  if (!set) {
    $("highscore-value").textContent = "記録なし";
    $("highscore-meta").textContent = "問題セットがありません";
    return;
  }
  if (!score) {
    $("highscore-value").textContent = "記録なし";
    $("highscore-meta").textContent = `${set.title}はまだ記録がありません`;
    return;
  }
  $("highscore-value").textContent = `${score.correct} / ${QUESTION_COUNT}`;
  $("highscore-meta").textContent = `${set.title}・制限 ${formatSec(score.limitMs / 1000)} の記録`;
}

function updateLogButton(): void {
  $("log-btn").textContent = logs.length ? `回答ログ（${logs.length}件）` : "回答ログ";
}

function syncStartEnabled(): void {
  ($("start-btn") as HTMLButtonElement).disabled = state.starting || state.sets.length === 0;
}

function isProblemSet(value: unknown): value is ProblemSet {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.file === "string" &&
    item.id.length > 0 &&
    item.title.length > 0 &&
    isSafeProblemFile(item.file)
  );
}

function fillSelect(preferredId: string | null): void {
  const select = setSelect();
  select.replaceChildren();
  for (const set of state.sets) {
    const option = document.createElement("option");
    option.value = set.id;
    option.textContent = set.title;
    select.append(option);
  }
  if (preferredId && state.sets.some((set) => set.id === preferredId)) select.value = preferredId;
}

async function loadRecords(set: ProblemSet) {
  const cached = cache.get(set.file);
  if (cached) return cached;
  const response = await fetch(`/api/sets/${encodeURIComponent(set.file)}`);
  if (!response.ok) throw new Error(`問題ファイルを読めません（${set.file}）`);
  const records = parseProblems(await response.text());
  if (records.length === 0) throw new Error("問題ファイルに有効なレコードがありません");
  cache.set(set.file, records);
  return records;
}

function newId(): string {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stopClock(): void {
  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.timerId) clearTimeout(state.timerId);
  state.raf = 0;
  state.timerId = 0;
}

function elapsedMs(): number {
  return Math.min(state.limitMs, Math.max(0, Math.round(performance.now() - state.startedAt)));
}

function presentQuestion(): void {
  const question = state.questions[state.index];
  const set = state.set;
  if (!question || !set) return;
  $("progress").textContent = `${set.title} · ${state.index + 1} / ${QUESTION_COUNT}`;
  $("term").textContent = question.term;
  $("live").textContent = `第${state.index + 1}問。${question.term}`;
  for (let i = 0; i < 2; i += 1) {
    const span = $(`choice-${i}`).querySelector("span");
    const choice = question.choices[i];
    if (span && choice) span.textContent = choice.text;
  }
  $("timer-bar").style.transform = "scaleX(1)";
  $("timer-label").textContent = `残り ${(state.limitMs / 1000).toFixed(1)}秒`;
  state.presentedAt = performance.now();
  startTimer();
}

function startTimer(): void {
  stopClock();
  state.startedAt = performance.now();
  const deadline = state.startedAt + state.limitMs;
  const tick = (now: number) => {
    if (!state.playing || state.locked) return;
    const remaining = Math.max(0, deadline - now);
    $("timer-bar").style.transform = `scaleX(${remaining / state.limitMs})`;
    $("timer-label").textContent = `残り ${(remaining / 1000).toFixed(1)}秒`;
    if (remaining <= 0) {
      onTimeout();
      return;
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  state.timerId = window.setTimeout(onTimeout, state.limitMs);
}

async function finishQuestion(outcome: Outcome, selected: string | null, elapsed: number): Promise<void> {
  const question = state.questions[state.index];
  const set = state.set;
  if (!question || !set) return;
  const entry: LogEntry = {
    sessionId: state.sessionId,
    at: new Date().toISOString(),
    setId: set.id,
    setTitle: set.title,
    index: state.index + 1,
    term: question.term,
    correctExplanation: question.correctExplanation,
    choices: question.choices.map((choice: Choice) => choice.text),
    selected,
    outcome,
    limitMs: state.limitMs,
    elapsedMs: elapsed,
  };
  state.session.push(entry);
  const saved = await postLog(entry);
  if (saved) logs = logs.concat(entry);
  else state.logSaveFailed = true;
  updateLogButton();

  if (state.index + 1 >= QUESTION_COUNT) {
    state.playing = false;
    stopClock();
    showResults();
    return;
  }
  state.index += 1;
  state.locked = false;
  presentQuestion();
}

function onChoice(index: number, event?: Event): void {
  if (!state.playing || state.locked) return;
  if (event && "repeat" in event && event.repeat) return;
  if (event && event.timeStamp < state.presentedAt) return;
  const choice = state.questions[state.index]?.choices[index];
  if (!choice) return;
  const elapsed = elapsedMs();
  state.locked = true;
  stopClock();
  finishQuestion(choice.correct ? "correct" : "incorrect", choice.text, elapsed);
}

function onTimeout(): void {
  if (!state.playing || state.locked) return;
  state.locked = true;
  stopClock();
  finishQuestion("timeout", null, state.limitMs);
}

function outcomeMark(outcome: Outcome): { text: string; className: string } {
  if (outcome === "correct") return { text: "○", className: "mark mark-ok" };
  return { text: "×", className: "mark mark-ng" };
}

function outcomeWord(outcome: Outcome): string {
  if (outcome === "correct") return "正解";
  if (outcome === "timeout") return "時間切れ";
  return "不正解";
}

function renderEntry(entry: LogEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "result-item";

  const badge = document.createElement("div");
  badge.className = "badge";
  const number = document.createElement("span");
  number.className = "result-no";
  number.textContent = String(entry.index);
  const mark = document.createElement("span");
  const markInfo = outcomeMark(entry.outcome);
  mark.className = markInfo.className;
  mark.textContent = markInfo.text;
  badge.append(number, mark);

  const body = document.createElement("div");
  const term = document.createElement("p");
  term.className = "result-term";
  term.textContent = entry.term;
  const status = document.createElement("p");
  status.className = "result-line";
  status.textContent = outcomeWord(entry.outcome);
  const yours = document.createElement("p");
  yours.className = "result-line";
  yours.textContent = entry.outcome === "timeout" ? "回答: 時間切れ" : `回答: ${entry.selected}`;
  const answer = document.createElement("p");
  answer.className = "result-line";
  answer.textContent = `正解: ${entry.correctExplanation}`;
  body.append(term, status, yours, answer);

  item.append(badge, body);
  return item;
}

function showResults(): void {
  const set = state.set;
  if (!set) return;
  const correct = state.session.filter((entry) => entry.outcome === "correct").length;
  const nextScore: Score = {
    correct,
    limitMs: state.limitMs,
    at: new Date().toISOString(),
  };
  const prev = scores[set.id] ?? null;
  const updated = isBetterScore(nextScore, prev);
  let saved = true;
  if (updated) {
    scores[set.id] = nextScore;
    saved = writeJson(KEYS.scores, scores);
  }

  $("result-score").textContent = `${correct} / ${QUESTION_COUNT}`;
  if (updated && saved) {
    $("result-note").textContent = "ハイスコアを更新しました";
  } else if (updated) {
    $("result-note").textContent = "ハイスコアを更新しました（このブラウザには保存できませんでした）";
  } else if (prev) {
    $("result-note").textContent = `ハイスコアは ${prev.correct} / ${QUESTION_COUNT} です`;
  } else {
    $("result-note").textContent = "";
  }
  if (state.logSaveFailed) {
    const note = $("result-note");
    note.textContent = note.textContent
      ? `${note.textContent}。ログファイルに書けませんでした`
      : "ログファイルに書けませんでした";
  }

  const list = $("result-list");
  list.replaceChildren();
  for (const entry of state.session) list.append(renderEntry(entry));
  show("result");
  renderHighScore();
}

function groupSessions(entries: LogEntry[]): LogEntry[][] {
  const sessions: LogEntry[][] = [];
  const index = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const id = entry.sessionId || `${entry.at}-${entry.setId}`;
    let session = index.get(id);
    if (!session) {
      session = [];
      index.set(id, session);
      sessions.push(session);
    }
    session.push(entry);
  }
  return sessions;
}

function renderLogs(): void {
  const root = $("log-list");
  root.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "まだ記録がありません。回答すると data/log.jsonl に残ります。";
    root.append(empty);
    return;
  }

  const sessions = groupSessions(logs);
  const hiddenCount = Math.max(0, sessions.length - 30);
  for (const session of sessions.slice(-30).reverse()) {
    const first = session[0];
    if (!first) continue;
    const article = document.createElement("article");
    article.className = "session";
    const correct = session.filter((entry) => entry.outcome === "correct").length;
    const heading = document.createElement("h3");
    heading.textContent = `${formatWhen(first.at)}　${first.setTitle}　正解 ${correct} / ${session.length}`;
    const list = document.createElement("ol");
    list.className = "result-list";
    for (const entry of session) list.append(renderEntry(entry));
    article.append(heading, list);
    root.append(article);
  }
  if (hiddenCount) {
    const more = document.createElement("p");
    more.className = "meta";
    more.textContent = `ほか ${hiddenCount} 回分のログも保存されています`;
    root.append(more);
  }
}

async function startGame(): Promise<void> {
  if (state.starting) return;
  const set = currentSet();
  if (!set) {
    setMessage("問題セットを選べません");
    show("open");
    return;
  }
  state.starting = true;
  syncStartEnabled();
  setMessage("");
  try {
    const settings = persistSettings();
    const records = await loadRecords(set);
    state.sessionId = newId();
    state.set = set;
    state.questions = buildQuiz(records, QUESTION_COUNT);
    state.session = [];
    state.index = 0;
    state.limitMs = Math.round(settings.limitSec * 1000);
    state.playing = true;
    state.locked = false;
    state.logSaveFailed = false;
    show("play");
    presentQuestion();
  } catch (error) {
    state.playing = false;
    stopClock();
    show("open");
    setMessage(error instanceof Error ? error.message : "開始できませんでした");
  } finally {
    state.starting = false;
    syncStartEnabled();
  }
}

function onKey(event: KeyboardEvent): void {
  if (!state.playing) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (event.key === "1") onChoice(0, event);
  if (event.key === "2") onChoice(1, event);
}

function bind(): void {
  setSelect().addEventListener("change", () => {
    persistSettings();
    renderHighScore();
  });
  limitInput().addEventListener("input", () => {
    persistSettings();
  });
  $("start-btn").addEventListener("click", () => {
    void startGame();
  });
  $("retry-btn").addEventListener("click", () => {
    void startGame();
  });
  $("home-btn").addEventListener("click", () => {
    show("open");
    renderHighScore();
    updateLogButton();
  });
  $("log-btn").addEventListener("click", () => {
    void (async () => {
      logs = await fetchLogs();
      updateLogButton();
      renderLogs();
      show("log");
    })();
  });
  $("log-home-btn").addEventListener("click", () => show("open"));
  for (const index of [0, 1]) {
    const button = $(`choice-${index}`);
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      onChoice(index, event);
    });
    button.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      onChoice(index, event);
    });
  }
  document.addEventListener("keydown", onKey);
}

async function init(): Promise<void> {
  bind();
  const saved = readJson(KEYS.settings) as Partial<Settings> | null;
  const limitSec = clampLimitSec(saved?.limitSec ?? 1);
  limitInput().value = String(limitSec);
  $("limit-output").textContent = formatSec(limitSec);
  logs = await fetchLogs();
  updateLogButton();
  try {
    const response = await fetch("/api/sets");
    if (!response.ok) throw new Error("問題セット一覧を読めません");
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("問題セット一覧の形式が不正です");
    state.sets = data.filter(isProblemSet);
    if (!state.sets.length) throw new Error("問題セットがありません");
    fillSelect(typeof saved?.setId === "string" ? saved.setId : null);
    persistSettings();
    setMessage("");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "読み込みに失敗しました");
  }
  renderHighScore();
  syncStartEnabled();
  show("open");
}

void init();
