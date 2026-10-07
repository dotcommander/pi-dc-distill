/**
 * Minimal RPC client for `pi --mode rpc`.
 *
 * Strict LF-delimited JSONL over stdin/stdout: records split on "\n" only,
 * optional trailing "\r" stripped (never a generic line reader). Commands go
 * out as JSON lines; responses carry the request `id`; agent events stream
 * asynchronously. Every line can be mirrored into a log file for artifacts.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface RpcEvent {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export interface RpcClientOptions {
  /** Explicit CLI executable; package-root selection takes precedence. */
  executable?: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Append every stdout/stderr line here for artifacts. */
  logFile?: string;
}

export class RpcClient {
  readonly events: RpcEvent[] = [];
  readonly stderr: string[] = [];
  exitCode: number | null = null;
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private exited = false;
  private waiters: Array<{ pred: (e: RpcEvent) => boolean; resolve: (e: RpcEvent) => void }> = [];
  private options: RpcClientOptions;

  constructor(options: RpcClientOptions) {
    this.options = options;
    if (options.logFile) mkdirSync(dirname(options.logFile), { recursive: true });
    const host = selectedHost(options);
    this.log(`[host] ${JSON.stringify(host)}`);
    this.proc = spawn(host.executable, [...host.prefix, "--mode", "rpc", ...options.args], {
      cwd: options.cwd,
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG, TERM: "dumb",
        PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1", ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderr.push(chunk);
      this.log(`[stderr] ${chunk}`);
    });
    this.proc.on("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
      this.log(`[exit] ${code}`);
    });
    this.proc.on("error", (error) => {
      this.exited = true;
      this.stderr.push(`Host launch failed: ${error.message}`);
      this.log(`[spawn-error] ${error.message}`);
    });
  }

  private log(line: string): void {
    if (!this.options.logFile) return;
    try {
      appendFileSync(this.options.logFile, line.endsWith("\n") ? line : `${line}\n`);
    } catch {
      // Artifact logging is best effort.
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim()) this.onLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    this.log(line);
    let event: RpcEvent;
    try {
      event = JSON.parse(line) as RpcEvent;
    } catch {
      return;
    }
    this.events.push(event);
    const remaining: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (waiter.pred(event)) waiter.resolve(event);
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }

  send(command: Record<string, unknown>): void {
    const line = `${JSON.stringify(command)}\n`;
    this.log(`[send] ${line}`);
    this.proc.stdin.write(line);
  }

  /** Index of the next event, for `since` bookkeeping. */
  mark(): number {
    return this.events.length;
  }

  /** Resolve with the first event (already seen or future) matching the predicate. */
  waitFor(
    pred: (e: RpcEvent) => boolean,
    timeoutMs = 30_000,
    options: { since?: number } = {},
  ): Promise<RpcEvent> {
    const since = options.since ?? 0;
    for (let i = since; i < this.events.length; i++) {
      if (pred(this.events[i]!)) return Promise.resolve(this.events[i]!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error(
          `Timed out after ${timeoutMs}ms waiting for event. `
          + `Last events: ${JSON.stringify(this.events.slice(-5).map((e) => e.type))} `
          + `stderr: ${this.stderr.join("").slice(-2000)}`,
        ));
      }, timeoutMs);
      const wrapped = (e: RpcEvent) => {
        clearTimeout(timer);
        resolve(e);
      };
      this.waiters.push({ pred, resolve: wrapped });
    });
  }

  /** Send a command with an id and wait for its matching response. */
  request(command: Record<string, unknown>, timeoutMs = 30_000): Promise<RpcEvent> {
    const id = `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const since = this.events.length;
    this.send({ id, ...command });
    return this.waitFor((e) => e.type === "response" && e.id === id, timeoutMs, { since });
  }

  async close(): Promise<void> {
    if (this.exited) return;
    try {
      this.proc.stdin.end();
    } catch {
      // Already gone.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.proc.kill("SIGKILL");
        resolve();
      }, 5000);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.proc.kill("SIGTERM");
    });
  }
}

/** Select an already installed host; never install or modify either runtime. */
export function selectedHost(options: RpcClientOptions): { executable: string; prefix: string[]; version?: string } {
  const environment = { ...process.env, ...options.env };
  const root = environment.DISTILL_PI_PACKAGE;
  const expected = environment.DISTILL_PI_EXPECT_VERSION;
  if (expected && !root) throw new Error("DISTILL_PI_EXPECT_VERSION requires DISTILL_PI_PACKAGE for exact host identity");
  if (!root) return { executable: options.executable ?? environment.DISTILL_PI_EXECUTABLE ?? "pi", prefix: [] };
  const packageRoot = resolve(root);
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== "@earendil-works/pi-coding-agent") throw new Error(`Unexpected Pi package at ${packageRoot}`);
  if (expected && manifest.version !== expected) throw new Error(`Expected Pi ${expected}, found ${manifest.version} at ${packageRoot}`);
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
  if (typeof entry !== "string") throw new Error(`Missing Pi CLI entry at ${packageRoot}`);
  return { executable: environment.DISTILL_PI_NODE ?? "node", prefix: [resolve(packageRoot, entry)], version: manifest.version };
}

export function eventsOfType(events: RpcEvent[], type: string): RpcEvent[] {
  return events.filter((e) => e.type === type);
}

/** Text of a message-ish object (string content or text blocks). */
export function messageText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && (block as { type?: string }).type === "text"
          ? String((block as { text?: string }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}
