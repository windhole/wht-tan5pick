export type Outcome = "correct" | "incorrect" | "timeout";

export type LogEntry = {
  sessionId: string;
  at: string;
  setId: string;
  setTitle: string;
  index: number;
  term: string;
  correctExplanation: string;
  choices: string[];
  selected: string | null;
  outcome: Outcome;
  limitMs: number;
  elapsedMs: number;
};

const OUTCOMES = new Set<Outcome>(["correct", "incorrect", "timeout"]);

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

export function parseLogEntry(value: unknown): LogEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const sessionId = shortText(item.sessionId, 80);
  const setId = shortText(item.setId, 200);
  const setTitle = shortText(item.setTitle, 200);
  const term = shortText(item.term, 500);
  const correctExplanation = shortText(item.correctExplanation, 2000);
  const at = typeof item.at === "string" ? item.at : "";
  const when = new Date(at);
  if (!sessionId || !setId || !setTitle || !term || !correctExplanation) return null;
  if (Number.isNaN(when.getTime())) return null;
  if (typeof item.index !== "number" || !Number.isInteger(item.index) || item.index < 1 || item.index > 10) {
    return null;
  }
  if (!Array.isArray(item.choices) || item.choices.length !== 2) return null;
  const choices = item.choices.map((choice) => shortText(choice, 2000));
  if (choices.some((choice) => !choice)) return null;
  const selected = item.selected === null ? null : shortText(item.selected, 2000);
  if (item.selected !== null && !selected) return null;
  if (typeof item.outcome !== "string" || !OUTCOMES.has(item.outcome as Outcome)) return null;
  if (item.outcome === "timeout" && selected !== null) return null;
  if (item.outcome !== "timeout" && selected === null) return null;
  if (typeof item.limitMs !== "number" || item.limitMs < 100 || item.limitMs > 10_000) return null;
  if (typeof item.elapsedMs !== "number" || item.elapsedMs < 0 || item.elapsedMs > item.limitMs) return null;
  return {
    sessionId,
    at: when.toISOString(),
    setId,
    setTitle,
    index: item.index,
    term,
    correctExplanation,
    choices: choices as [string, string],
    selected,
    outcome: item.outcome as Outcome,
    limitMs: item.limitMs,
    elapsedMs: item.elapsedMs,
  };
}

export function parseLogFile(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = parseLogEntry(JSON.parse(trimmed) as unknown);
      if (entry) entries.push(entry);
    } catch {
      continue;
    }
  }
  return entries;
}

export function formatLogLine(entry: LogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}
