export type WorkflowMode = "read-only" | "mutating" | "mixed";

export interface WorkflowPhaseMeta {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  mode?: WorkflowMode;
  phases: readonly WorkflowPhaseMeta[];
  verification?: string | readonly string[];
}

export interface WorkflowPhaseEvent {
  meta: WorkflowMeta;
  title: string;
  detail?: string;
  index: number;
  total: number;
}

export interface WorkflowLogEvent {
  meta: WorkflowMeta;
  phase?: string;
  message: string;
}

export interface WorkflowRunOptions {
  strictPhases?: boolean;
  onPhase?: (event: WorkflowPhaseEvent) => void;
  onLog?: (event: WorkflowLogEvent) => void;
}

export interface WorkflowRunContext {
  readonly meta: WorkflowMeta;
  phase(title: string, detail?: string): WorkflowPhaseEvent;
  log(message: string): WorkflowLogEvent;
  currentPhase(): string | undefined;
  seenPhases(): string[];
  assertSeen(titles?: readonly string[]): void;
}

export interface WorkflowDefinition {
  readonly meta: WorkflowMeta;
  readonly phaseTitles: readonly string[];
  run<T>(
    fn: (ctx: WorkflowRunContext) => Promise<T> | T,
    options?: WorkflowRunOptions,
  ): Promise<T>;
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Workflow meta.${field} must be a non-empty string`);
  }
}

function validateMeta(meta: WorkflowMeta): void {
  requireText(meta.name, "name");
  requireText(meta.description, "description");
  if (!Array.isArray(meta.phases) || meta.phases.length === 0) {
    throw new Error("Workflow meta.phases must contain at least one phase");
  }

  const seen = new Set<string>();
  for (const phase of meta.phases) {
    requireText(phase.title, "phases[].title");
    if (seen.has(phase.title)) {
      throw new Error(`Workflow phase ${JSON.stringify(phase.title)} is duplicated`);
    }
    seen.add(phase.title);
  }
}

function freezeMeta(meta: WorkflowMeta): WorkflowMeta {
  validateMeta(meta);
  return Object.freeze({
    ...meta,
    phases: Object.freeze(
      meta.phases.map((phase) => Object.freeze({ ...phase })),
    ),
  });
}

function createRunContext(
  meta: WorkflowMeta,
  options: WorkflowRunOptions = {},
): WorkflowRunContext {
  const strictPhases = options.strictPhases ?? true;
  const titles = meta.phases.map((phase) => phase.title);
  const titleSet = new Set(titles);
  const seen: string[] = [];
  let current: string | undefined;

  return {
    meta,
    phase(title, detail) {
      if (strictPhases && !titleSet.has(title)) {
        throw new Error(
          `Workflow ${meta.name} emitted unknown phase ${JSON.stringify(title)}; expected one of: ${titles.join(", ")}`,
        );
      }
      current = title;
      if (!seen.includes(title)) seen.push(title);
      const event: WorkflowPhaseEvent = {
        meta,
        title,
        detail: detail ?? meta.phases.find((phase) => phase.title === title)?.detail,
        index: titles.indexOf(title),
        total: titles.length,
      };
      options.onPhase?.(event);
      return event;
    },
    log(message) {
      requireText(message, "log message");
      const event: WorkflowLogEvent = { meta, phase: current, message };
      options.onLog?.(event);
      return event;
    },
    currentPhase() {
      return current;
    },
    seenPhases() {
      return [...seen];
    },
    assertSeen(required = titles) {
      const missing = required.filter((title) => !seen.includes(title));
      if (missing.length > 0) {
        throw new Error(
          `Workflow ${meta.name} did not enter phase(s): ${missing.join(", ")}`,
        );
      }
    },
  };
}

function define(meta: WorkflowMeta): WorkflowDefinition {
  const frozenMeta = freezeMeta(meta);
  const phaseTitles = Object.freeze(
    frozenMeta.phases.map((phase) => phase.title),
  );

  return Object.freeze({
    meta: frozenMeta,
    phaseTitles,
    run<T>(
      fn: (ctx: WorkflowRunContext) => Promise<T> | T,
      options?: WorkflowRunOptions,
    ): Promise<T> {
      const ctx = createRunContext(frozenMeta, options);
      return Promise.resolve().then(() => fn(ctx));
    },
  });
}

async function run<T>(
  definition: WorkflowDefinition,
  fn: (ctx: WorkflowRunContext) => Promise<T> | T,
  options?: WorkflowRunOptions,
): Promise<T> {
  return definition.run(fn, options);
}

export const Workflow = {
  define,
  run,
  validate: validateMeta,
  phaseTitles(meta: WorkflowMeta): string[] {
    validateMeta(meta);
    return meta.phases.map((phase) => phase.title);
  },
} as const;
