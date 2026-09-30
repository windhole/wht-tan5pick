import {
  QUESTION_COUNT,
  buildQuiz,
  clampLimitSec,
  isBetterScore,
  parseProblems,
} from "./quiz.js";

const KEYS = {
  settings: "tan5pick.settings.v1",
  scores: "tan5pick.highscores.v1",
  logs: "tan5pick.logs.v1",
};

const $ = (id) => document.getElementById(id);

const cache = new Map();
const state = {
  sets: [],
  starting: false,
  playing: false,
  locked: false,
  presentedAt: 0,
  set: null,
  questions: [],
  session: [],
  sessionId: "",
  index: 0,
  limitMs: 1000,
  startedAt: 0,
  raf: 0,
  timerId: 0,
};

let logs = readJson(KEYS.logs, []);
let scores = readJson(KEYS.scores, {});
if (!Array.isArray(logs)) logs = [];
if (!scores || typeof scores !== "object" || Array.isArray(scores)) scores = {};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveLogs(next) {
  let batch = next;
  for (;;) {
    if (writeJson(KEYS.logs, batch)) return batch;
    if (batch.length <= 1) return [];
    batch = batch.slice(Math.ceil(batch.length / 2));
  }
}

function show(name) {
  for (const id of ["open", "play", "result", "log"]) {
    $(`screen-${id}`).hidden = id !== name;
  }
}

function setMessage(text) {
  const el = $("open-message");
  el.hidden = !text;
  el.textContent = text || "";
}

function formatSec(sec) {
  return `${clampLimitSec(sec).toFixed(1)}秒`;
}

function formatWhen(iso) {
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

function currentSet() {
  return state.sets.find((set) => set.id === $("set-select").value) || null;
}

function persistSettings() {
  const settings = {
    setId: $("set-select").value || null,
    limitSec: clampLimitSec($("limit-range").value),
  };
  $("limit-range").value = String(settings.limitSec);
  $("limit-output").textContent = formatSec(settings.limitSec);
  writeJson(KEYS.settings, settings);
  return settings;
}

function renderHighScore() {
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

function updateLogButton() {
  $("log-btn").textContent = logs.length ? `回答ログ（${logs.length}件）` : "回答ログ";
}

function syncStartEnabled() {
  $("start-btn").disabled = state.starting || state.sets.length === 0;
}

function isSafeFile(file) {
  return typeof file === "string" && /^[^/\\]+\.txt$/.test(file) && !file.includes("..");
}

function normalizeSets(data) {
  if (!Array.isArray(data)) throw new Error("問題セット一覧の形式が不正です");
  const sets = [];
  for (const item of data) {
    if (!item || typeof item.id !== "string" || typeof item.title !== "string") continue;
    if (!item.id || !item.title || !isSafeFile(item.file)) continue;
    sets.push({ id: item.id, title: item.title, file: item.file });
  }
  return sets;
}

function fillSelect(preferredId) {
  const select = $("set-select");
  select.replaceChildren();
  for (const set of state.sets) {
    const option = document.createElement("option");
    option.value = set.id;
    option.textContent = set.title;
    select.append(option);
  }
  if (state.sets.some((set) => set.id === preferredId)) select.value = preferredId;
}

async function loadRecords(set) {
  if (cache.has(set.file)) return cache.get(set.file);
  const response = await fetch(`data/${encodeURIComponent(set.file)}`);
  if (!response.ok) throw new Error(`問題ファイルを読めません（${set.file}）`);
  const records = parseProblems(await response.text());
  if (records.length === 0) throw new Error("問題ファイルに有効なレコードがありません");
  cache.set(set.file, records);
  return records;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stopClock() {
  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.timerId) clearTimeout(state.timerId);
  state.raf = 0;
  state.timerId = 0;
}

function elapsedMs() {
  return Math.min(state.limitMs, Math.max(0, Math.round(performance.now() - state.startedAt)));
}

function presentQuestion() {
  const question = state.questions[state.index];
  $("progress").textContent = `${state.set.title} · ${state.index + 1} / ${QUESTION_COUNT}`;
  $("term").textContent = question.term;
  $("live").textContent = `第${state.index + 1}問。${question.term}`;
  for (let i = 0; i < 2; i += 1) {
    $(`choice-${i}`).querySelector("span").textContent = question.choices[i].text;
  }
  $("timer-bar").style.transform = "scaleX(1)";
  $("timer-label").textContent = `残り ${(state.limitMs / 1000).toFixed(1)}秒`;
  state.presentedAt = performance.now();
  startTimer();
}

function startTimer() {
  stopClock();
  state.startedAt = performance.now();
  const deadline = state.startedAt + state.limitMs;
  const tick = (now) => {
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
  state.timerId = setTimeout(onTimeout, state.limitMs);
}

function finishQuestion(outcome, selected, elapsed) {
  const question = state.questions[state.index];
  const entry = {
    sessionId: state.sessionId,
    at: new Date().toISOString(),
    setId: state.set.id,
    setTitle: state.set.title,
    index: state.index + 1,
    term: question.term,
    correctExplanation: question.correctExplanation,
    choices: question.choices.map((choice) => choice.text),
    selected,
    outcome,
    limitMs: state.limitMs,
    elapsedMs: elapsed,
  };
  state.session.push(entry);
  logs = saveLogs(logs.concat(entry));
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

function onChoice(index, event) {
  if (!state.playing || state.locked) return;
  if (event?.repeat) return;
  if (event && event.timeStamp < state.presentedAt) return;
  const choice = state.questions[state.index]?.choices[index];
  if (!choice) return;
  const elapsed = elapsedMs();
  state.locked = true;
  stopClock();
  finishQuestion(choice.correct ? "correct" : "incorrect", choice.text, elapsed);
}

function onTimeout() {
  if (!state.playing || state.locked) return;
  state.locked = true;
  stopClock();
  finishQuestion("timeout", null, state.limitMs);
}

function outcomeMark(outcome) {
  if (outcome === "correct") return { text: "○", className: "mark mark-ok" };
  return { text: "×", className: "mark mark-ng" };
}

function outcomeWord(outcome) {
  if (outcome === "correct") return "正解";
  if (outcome === "timeout") return "時間切れ";
  return "不正解";
}

function renderEntry(entry) {
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

function showResults() {
  const correct = state.session.filter((entry) => entry.outcome === "correct").length;
  const nextScore = {
    correct,
    limitMs: state.limitMs,
    at: new Date().toISOString(),
  };
  const prev = scores[state.set.id];
  const updated = isBetterScore(nextScore, prev);
  let saved = true;
  if (updated) {
    scores[state.set.id] = nextScore;
    saved = writeJson(KEYS.scores, scores);
  }

  $("result-score").textContent = `${correct} / ${QUESTION_COUNT}`;
  if (updated && saved) {
    $("result-note").textContent = "ハイスコアを更新しました";
  } else if (updated) {
    $("result-note").textContent = "ハイスコアを更新しました（このブラウザには保存できませんでした）";
  } else {
    $("result-note").textContent = `ハイスコアは ${prev.correct} / ${QUESTION_COUNT} です`;
  }

  const list = $("result-list");
  list.replaceChildren();
  for (const entry of state.session) list.append(renderEntry(entry));
  show("result");
  renderHighScore();
}

function groupSessions(entries) {
  const sessions = [];
  const index = new Map();
  for (const entry of entries) {
    const id = entry.sessionId || `${entry.at}-${entry.setId}`;
    if (!index.has(id)) {
      const session = [];
      index.set(id, session);
      sessions.push(session);
    }
    index.get(id).push(entry);
  }
  return sessions;
}

function renderLogs() {
  const root = $("log-list");
  root.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "まだ記録がありません。1ゲームが終わると、各問の回答と正誤がここに残ります。";
    root.append(empty);
    return;
  }

  const sessions = groupSessions(logs);
  const hiddenCount = Math.max(0, sessions.length - 30);
  for (const session of sessions.slice(-30).reverse()) {
    const article = document.createElement("article");
    article.className = "session";
    const first = session[0];
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

async function startGame() {
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

function onKey(event) {
  if (!state.playing) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (event.key === "1") onChoice(0, event);
  if (event.key === "2") onChoice(1, event);
}

function bind() {
  $("set-select").addEventListener("change", () => {
    persistSettings();
    renderHighScore();
  });
  $("limit-range").addEventListener("input", persistSettings);
  $("start-btn").addEventListener("click", () => {
    startGame();
  });
  $("retry-btn").addEventListener("click", () => {
    startGame();
  });
  $("home-btn").addEventListener("click", () => {
    show("open");
    renderHighScore();
    updateLogButton();
  });
  $("log-btn").addEventListener("click", () => {
    renderLogs();
    show("log");
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

async function init() {
  bind();
  const settings = readJson(KEYS.settings, { setId: null, limitSec: 1 });
  const limitSec = clampLimitSec(settings?.limitSec ?? 1);
  $("limit-range").value = String(limitSec);
  $("limit-output").textContent = formatSec(limitSec);
  updateLogButton();
  try {
    const response = await fetch("data/sets.json");
    if (!response.ok) throw new Error("問題セット一覧を読めません");
    state.sets = normalizeSets(await response.json());
    if (!state.sets.length) throw new Error("問題セットがありません");
    fillSelect(settings?.setId);
    persistSettings();
    setMessage("");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "読み込みに失敗しました");
  }
  renderHighScore();
  syncStartEnabled();
  show("open");
}

init();
