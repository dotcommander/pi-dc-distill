// Shared fake/spy infrastructure for facade .fake() methods.
// Each facade installs a FakeSink that records calls instead of emitting them.
// One restore registry lets tests reset every active fake in an afterEach.

export interface FakeRecord {
  method: string;
  args: unknown[];
}

export class FakeSink {
  records: FakeRecord[] = [];
  record(method: string, args: unknown[]): void {
    this.records.push({ method, args });
  }
  byMethod(method: string): FakeRecord[] {
    return this.records.filter((r) => r.method === method);
  }
}

export type Matcher = string | RegExp | ((text: string) => boolean);

export function matchText(text: string, m?: Matcher): boolean {
  if (m === undefined) return true;
  if (typeof m === "string") return text.includes(m);
  if (m instanceof RegExp) return m.test(text);
  return m(text);
}

// Extract a string payload from a recorded call for text matching.
export function firstString(args: unknown[]): string {
  for (const a of args) if (typeof a === "string") return a;
  return "";
}

const restores = new Set<() => void>();

export function registerRestore(fn: () => void): void {
  restores.add(fn);
}

export function restoreAll(): void {
  for (const fn of restores) fn();
  restores.clear();
}

// Per-facade fake-sink lifecycle. Each facade owns ONE slot via createSinkSlot();
// the active sink lives in this closure, never shared across facades. install()
// swaps in a fresh sink and registers its restore so restoreAll() resets it; the
// restore is identity-guarded so a stale restore can't clobber a newer install.
export interface SinkSlot {
  /** Record a call when a fake is active. Returns true if recorded (caller should bail). */
  tap(method: string, args: unknown[]): boolean;
  /** The live sink when a fake is active, else null. For emit paths that record then continue. */
  active(): FakeSink | null;
  /** Install a fresh sink, register its restore, and return both. */
  install(): { sink: FakeSink; restore: () => void };
}

export function createSinkSlot(): SinkSlot {
  let current: FakeSink | null = null;
  return {
    tap(method, args) {
      if (current) {
        current.record(method, args);
        return true;
      }
      return false;
    },
    active() {
      return current;
    },
    install() {
      const sink = (current = new FakeSink());
      const restore = () => {
        if (current === sink) current = null;
      };
      registerRestore(restore);
      return { sink, restore };
    },
  };
}

// Assertion helpers — throw readable Errors (consumed inside bun test `it`).
export function assertMatch(
  records: FakeRecord[],
  label: string,
  m?: Matcher,
): void {
  const hit = records.some((r) => matchText(firstString(r.args), m));
  if (!hit) {
    const seen = records.map((r) => JSON.stringify(firstString(r.args)));
    throw new Error(
      `Expected a ${label} matching ${describeMatcher(m)}, but saw: [${seen.join(", ")}]`,
    );
  }
}

export function assertNone(records: FakeRecord[], label: string): void {
  if (records.length > 0) {
    const seen = records.map((r) => JSON.stringify(firstString(r.args)));
    throw new Error(
      `Expected no ${label}, but saw ${records.length}: [${seen.join(", ")}]`,
    );
  }
}

// Registration-fake assertions — one source of truth for Tool/Command .fake().
// `noun` is the facade kind ("tool"/"command") woven into the message as data.
export function assertRegistered(
  records: FakeRecord[],
  noun: string,
  name: string,
): void {
  const hit = records.some((r) => firstString(r.args) === name);
  if (!hit) {
    const seen = records.map((r) => JSON.stringify(firstString(r.args)));
    throw new Error(
      `Expected ${noun} ${JSON.stringify(name)} to be registered, but registered: [${seen.join(", ")}]`,
    );
  }
}

export function assertNotRegistered(
  records: FakeRecord[],
  noun: string,
  name: string,
): void {
  const hit = records.some((r) => firstString(r.args) === name);
  if (hit) {
    throw new Error(
      `Expected ${noun} ${JSON.stringify(name)} to NOT be registered, but it was.`,
    );
  }
}

export function registeredNames(records: FakeRecord[]): string[] {
  return records.map((r) => firstString(r.args));
}

function describeMatcher(m?: Matcher): string {
  if (m === undefined) return "anything";
  if (typeof m === "string") return `substring ${JSON.stringify(m)}`;
  if (m instanceof RegExp) return String(m);
  return "predicate";
}
