/**
 * Task finite-state machine — the single authority on task state transitions.
 *
 * One transition table + a lock+CAS engine shared by the task tool handler, the
 * taskagent bridge, and any storage backend, so they cannot drift out of
 * agreement. Storage-agnostic: callers pass an FsmStore port (read/write/lockPath).
 *
 * Every mutation routes through `transition()`: hold an exclusive lock, re-read
 * the record from the store (record is the sole source of truth), version-check
 * it (compare-and-swap = both lost-update guard AND confabulation guard — a
 * writer must present the version it read), validate the edge against
 * TRANSITIONS, and enforce per-edge evidence requirements.
 *
 * @module dc-framework/lib/_task-fsm
 */

import { withLock } from "./_file-lock.ts";

export const TASK_STATES = [
  "open",
  "ready",
  "claimed",
  "running",
  "blocked",
  "verifying",
  "done",
  "failed",
  "needs-review",
  "dropped",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export type EvidenceKind =
  | "exit-code"
  | "file-line"
  | "gate-output"
  | "baseline-diff";

export interface EvidenceRef {
  kind: EvidenceKind;
  /** The cited value: "exit=0", "src/foo.ts:42", a command + output tail, a diff summary. */
  ref: string;
  /** ISO 8601 capture time. */
  ts: string;
}

interface TransitionRule {
  to: TaskState;
  /** Edge asserts work happened => requires >=1 EvidenceRef. Mechanical edges (claim/release/ready/block) are self-evidencing. */
  requiresEvidence?: boolean;
}

/** The single source of truth for legal state transitions. */
export const TRANSITIONS: Record<TaskState, readonly TransitionRule[]> = {
  open: [{ to: "ready" }, { to: "dropped" }],
  ready: [{ to: "claimed" }, { to: "dropped" }],
  claimed: [{ to: "running" }, { to: "ready" }, { to: "failed" }],
  running: [
    { to: "verifying", requiresEvidence: true },
    { to: "blocked" },
    { to: "failed" },
    { to: "ready" },
    { to: "running" },
  ],
  blocked: [
    { to: "ready" },
    { to: "running" },
    { to: "needs-review" },
    { to: "failed" },
  ],
  verifying: [
    { to: "done", requiresEvidence: true },
    { to: "failed", requiresEvidence: true },
    { to: "needs-review" },
    { to: "running" },
  ],
  done: [],
  failed: [{ to: "ready" }],
  "needs-review": [
    { to: "done", requiresEvidence: true },
    { to: "ready" },
    { to: "dropped" },
  ],
  dropped: [],
};

function ruleFor(from: TaskState, to: TaskState): TransitionRule | undefined {
  return TRANSITIONS[from]?.find((r) => r.to === to);
}

/** Pure predicate: is `from -> to` a legal edge? */
export function canTransition(from: TaskState, to: TaskState): boolean {
  return ruleFor(from, to) !== undefined;
}

/** Pure predicate: does `from -> to` require cited evidence? */
export function transitionRequiresEvidence(
  from: TaskState,
  to: TaskState,
): boolean {
  return ruleFor(from, to)?.requiresEvidence === true;
}

/** Minimal record shape the engine needs; a backend's record type is a superset. */
export interface FsmRecord {
  id: string;
  status: TaskState;
  version: number;
  owner?: string;
  leaseExpiresAt?: string;
  evidence?: EvidenceRef[];
  updatedAt?: string;
}

/** Storage port the engine drives. Implemented by each backend. */
export interface FsmStore<R extends FsmRecord> {
  read(id: string): Promise<R | undefined>;
  write(rec: R): Promise<void>;
  /** Path to the per-record lock file. */
  lockPath(id: string): string;
}

export type TransitionResult<R> =
  | { ok: true; record: R }
  | { ok: false; reason: string; current?: R };

export interface TransitionInput<R extends FsmRecord> {
  id: string;
  /** Writer identity (agent/session id) — lock owner and the owner check. */
  owner: string;
  /** The version the caller last read (read-token). Write refused unless on-disk version still matches. */
  expectedVersion: number;
  to: TaskState;
  evidence?: EvidenceRef[];
  /** Apply additional field mutations to the next record (e.g. lastError, attempts). */
  mutate?: (rec: R) => void;
  /** Skip the owner-match check (only for unowned/claim transitions). Default false. */
  allowForeign?: boolean;
}

/**
 * The single chokepoint every state mutation routes through.
 * Lock -> re-read -> version-CAS -> owner check -> legal-edge -> evidence -> bump version -> write.
 */
export async function transition<R extends FsmRecord>(
  store: FsmStore<R>,
  input: TransitionInput<R>,
): Promise<TransitionResult<R>> {
  return withLock(store.lockPath(input.id), input.owner, async () => {
    const cur = await store.read(input.id);
    if (!cur) return { ok: false, reason: "not-found" };

    if (cur.version !== input.expectedVersion) {
      return {
        ok: false,
        reason: `version-conflict (expected ${input.expectedVersion}, on-disk ${cur.version})`,
        current: cur,
      };
    }

    if (!input.allowForeign && cur.owner && cur.owner !== input.owner) {
      return { ok: false, reason: `not-owner (held by ${cur.owner})`, current: cur };
    }

    const rule = ruleFor(cur.status, input.to);
    if (!rule) {
      return {
        ok: false,
        reason: `illegal-transition (${cur.status} -> ${input.to})`,
        current: cur,
      };
    }

    const evidence = input.evidence ?? [];
    if (rule.requiresEvidence && evidence.length === 0) {
      return {
        ok: false,
        reason: `transition ${cur.status} -> ${input.to} requires evidence`,
        current: cur,
      };
    }

    const next = { ...cur } as R;
    next.status = input.to;
    next.version = cur.version + 1;
    next.updatedAt = new Date().toISOString();
    if (evidence.length > 0) {
      next.evidence = [...(cur.evidence ?? []), ...evidence];
    }
    input.mutate?.(next);

    await store.write(next);
    return { ok: true, record: next };
  });
}

function leaseExpired(rec: FsmRecord, now: number): boolean {
  if (!rec.leaseExpiresAt) return true;
  return new Date(rec.leaseExpiresAt).getTime() <= now;
}

export interface ClaimInput<R extends FsmRecord> {
  id: string;
  owner: string;
  expectedVersion: number;
  ttlMs: number;
  /** Target state for the claim (default "claimed"). */
  to?: TaskState;
  mutate?: (rec: R) => void;
  now?: number;
}

/**
 * Acquire the lease: ready/open/failed -> claimed (or a custom target), setting
 * owner + leaseExpiresAt. Succeeds only if unowned or the lease has expired.
 */
export async function claim<R extends FsmRecord>(
  store: FsmStore<R>,
  input: ClaimInput<R>,
): Promise<TransitionResult<R>> {
  const now = input.now ?? Date.now();
  const to = input.to ?? "claimed";
  return withLock(store.lockPath(input.id), input.owner, async () => {
    const cur = await store.read(input.id);
    if (!cur) return { ok: false, reason: "not-found" };
    if (cur.version !== input.expectedVersion) {
      return {
        ok: false,
        reason: `version-conflict (expected ${input.expectedVersion}, on-disk ${cur.version})`,
        current: cur,
      };
    }
    if (cur.owner && cur.owner !== input.owner && !leaseExpired(cur, now)) {
      return { ok: false, reason: `already-claimed (by ${cur.owner})`, current: cur };
    }
    if (!ruleFor(cur.status, to)) {
      return {
        ok: false,
        reason: `illegal-transition (${cur.status} -> ${to})`,
        current: cur,
      };
    }
    const next = { ...cur } as R;
    next.status = to;
    next.version = cur.version + 1;
    next.owner = input.owner;
    next.leaseExpiresAt = new Date(now + input.ttlMs).toISOString();
    next.updatedAt = new Date(now).toISOString();
    input.mutate?.(next);
    await store.write(next);
    return { ok: true, record: next };
  });
}

export interface HeartbeatInput {
  id: string;
  owner: string;
  ttlMs: number;
  now?: number;
}

/** Renew the lease. Rejected if the caller no longer owns the task (lease stolen/reclaimed). */
export async function heartbeat<R extends FsmRecord>(
  store: FsmStore<R>,
  input: HeartbeatInput,
): Promise<TransitionResult<R>> {
  const now = input.now ?? Date.now();
  return withLock(store.lockPath(input.id), input.owner, async () => {
    const cur = await store.read(input.id);
    if (!cur) return { ok: false, reason: "not-found" };
    if (cur.owner !== input.owner) {
      return { ok: false, reason: `lease-lost (held by ${cur.owner ?? "none"})`, current: cur };
    }
    const next = { ...cur } as R;
    next.version = cur.version + 1;
    next.leaseExpiresAt = new Date(now + input.ttlMs).toISOString();
    next.updatedAt = new Date(now).toISOString();
    await store.write(next);
    return { ok: true, record: next };
  });
}

export interface ReclaimInput {
  id: string;
  by: string;
  now?: number;
}

/**
 * If the lease has expired, return the task to `ready` and clear the owner so a
 * fresh agent can pick it up. No-op (ok:false reason "lease-active") otherwise.
 */
export async function reclaimIfStale<R extends FsmRecord>(
  store: FsmStore<R>,
  input: ReclaimInput,
): Promise<TransitionResult<R>> {
  const now = input.now ?? Date.now();
  return withLock(store.lockPath(input.id), input.by, async () => {
    const cur = await store.read(input.id);
    if (!cur) return { ok: false, reason: "not-found" };
    if (!leaseExpired(cur, now)) {
      return { ok: false, reason: "lease-active", current: cur };
    }
    if (!ruleFor(cur.status, "ready")) {
      return {
        ok: false,
        reason: `illegal-transition (${cur.status} -> ready)`,
        current: cur,
      };
    }
    const next = { ...cur } as R;
    next.status = "ready";
    next.version = cur.version + 1;
    next.owner = undefined;
    next.leaseExpiresAt = undefined;
    next.updatedAt = new Date(now).toISOString();
    await store.write(next);
    return { ok: true, record: next };
  });
}
