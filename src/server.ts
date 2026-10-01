import { appendFile, mkdir } from "node:fs/promises";
import { Glob } from "bun";
import { formatLogLine, parseLogEntry, parseLogFile } from "./log.ts";
import { isSafeProblemFile, problemSetTitle } from "./quiz.ts";

const dataDir = `${import.meta.dir}/../data`;
const logPath = `${dataDir}/log.jsonl`;
const clientDir = `${import.meta.dir}/client`;
const port = 3000;

type ProblemSet = {
  id: string;
  title: string;
  file: string;
};

async function listSets(): Promise<ProblemSet[]> {
  const sets: ProblemSet[] = [];
  const glob = new Glob("*.txt");
  try {
    for await (const file of glob.scan({ cwd: dataDir, onlyFiles: true })) {
      if (!isSafeProblemFile(file)) continue;
      const text = await Bun.file(`${dataDir}/${file}`).text();
      sets.push({
        id: file.replace(/\.txt$/i, ""),
        title: problemSetTitle(text, file),
        file,
      });
    }
  } catch {
    return [];
  }
  sets.sort((a, b) => a.title.localeCompare(b.title, "ja"));
  return sets;
}

async function readLogs() {
  const file = Bun.file(logPath);
  if (!(await file.exists())) return [];
  return parseLogFile(await file.text());
}

async function appendLog(entry: NonNullable<ReturnType<typeof parseLogEntry>>): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(logPath, formatLogLine(entry), "utf8");
}

async function clientJs(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [`${clientDir}/main.ts`],
    target: "browser",
    format: "esm",
    sourcemap: "none",
  });
  if (!result.success) {
    const detail = result.logs.map((log) => String(log)).join("\n");
    return new Response(detail || "bundle failed", { status: 500 });
  }
  const output = result.outputs.find((item) => item.path.endsWith(".js"));
  if (!output) return new Response("bundle was empty", { status: 500 });
  return new Response(await output.text(), {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  });
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(Bun.file(`${clientDir}/index.html`));
    }
    if (url.pathname === "/app.css") {
      return new Response(Bun.file(`${clientDir}/app.css`));
    }
    if (url.pathname === "/app.js") return clientJs();
    if (url.pathname === "/api/sets") return Response.json(await listSets());
    if (url.pathname === "/api/logs" && req.method === "GET") {
      return Response.json(await readLogs());
    }
    if (url.pathname === "/api/logs" && req.method === "POST") {
      let body: unknown;
      try {
        const text = await req.text();
        if (text.length > 20_000) return new Response("too large", { status: 413 });
        body = JSON.parse(text) as unknown;
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const entry = parseLogEntry(body);
      if (!entry) return new Response("bad entry", { status: 400 });
      try {
        await appendLog(entry);
      } catch {
        return new Response("write failed", { status: 500 });
      }
      return Response.json({ ok: true });
    }

    const prefix = "/api/sets/";
    if (url.pathname.startsWith(prefix)) {
      let file = "";
      try {
        file = decodeURIComponent(url.pathname.slice(prefix.length));
      } catch {
        return new Response("bad file", { status: 400 });
      }
      if (!isSafeProblemFile(file)) return new Response("bad file", { status: 400 });
      const problem = Bun.file(`${dataDir}/${file}`);
      if (!(await problem.exists())) return new Response("not found", { status: 404 });
      return new Response(problem, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`http://127.0.0.1:${server.port}/`);
