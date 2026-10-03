import { isAbsolute } from "node:path";
import type { DistillHandoffTask, DistillHandoffDecision, DistillHandoffPrecondition, ParsedStructuredDistillHandoff } from "../handoff.ts";
import type { ObservationSnapshot } from "./types.ts";
import { digest } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import { pathIdentity } from "./tool-tracker.ts";
import { evaluatePreconditions } from "./observed-readiness.ts";

export interface CheckpointSourceReference {
  sessionId?: string; entryId: string; messageIndex?: number; blockIndex?: number;
  start?: number; end?: number; contentDigest: string;
  sourceKind: "user" | "bash" | "agent-declaration" | "tool-observation" | "legacy";
}
export interface CheckpointResolution { reason: string; replacement?: string }
export interface CheckpointTask extends DistillHandoffTask {
  requires: string[]; source?: CheckpointSourceReference; resolution?: CheckpointResolution;
}
export interface CheckpointPin {
  id: string; purpose: "workset" | "constraint" | "request"; text: string;
  source: CheckpointSourceReference; status: "active" | "resolved" | "superseded";
  resolution?: CheckpointResolution;
}
export interface CheckpointFailure {
  id: string; objective: string; signature: string; attemptedFix: string;
  observedOutcome: string; sources: CheckpointSourceReference[];
  resolution: string | null; occurrences: number;
}
export interface ResumeCheckpointV1 {
  version: 1; objective: string; files: { read: string[]; modified: string[] }; tasks: CheckpointTask[]; pins: CheckpointPin[];
  constraints: string[]; decisions: DistillHandoffDecision[];
  preconditions: DistillHandoffPrecondition[]; evidence: ObservationSnapshot;
  risks: string[]; failures: CheckpointFailure[]; omittedResolvedFailures: number;
  predecessor: { checkpointDigest: string; entryId: string | null } | null;
  updateEntryId: string | null;
}
export interface CheckpointUpdate { checkpoint: ResumeCheckpointV1; checkpointDigest: string; entryId: string }
export function emptyCheckpoint(): ResumeCheckpointV1 {
  return { version: 1, objective: "", files: { read: [], modified: [] }, tasks: [], pins: [], constraints: [], decisions: [],
    preconditions: [], evidence: { mutationEpoch: 0, fileReads: [], verification: [], modifiedPaths: [] },
    risks: [], failures: [], omittedResolvedFailures: 0, predecessor: null, updateEntryId: null };
}
/** Shared operation walk bounds, checked before serialization, including decoded values. */
export interface StructuralBudget { visited: number; containers: number }
export function assertStructuralBounds(value: unknown, budget: StructuralBudget = { visited: 0, containers: 0 }): void {
  const values: unknown[] = [value];
  const depths: number[] = [0];
  const ancestors = new Set<object>();
  const malformed = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  while (values.length) {
    const current = values.pop();
    const depth = depths.pop()!;
    // Negative depth is an exit marker: it does not count as another visit.
    if (depth < 0) { ancestors.delete(current as object); continue; }
    if (++budget.visited > 1_000_000 || depth > 64) throw new CompactionInputError("required analysis structural limit exceeded", "required_analysis_overflow");
    if (typeof current === "string" && malformed.test(current)) throw new CompactionInputError("malformed Unicode in checkpoint input");
    if (current && typeof current === "object") {
      if (ancestors.has(current)) throw new CompactionInputError("cyclic checkpoint container");
      ancestors.add(current);
      values.push(current); depths.push(-1);
      if (++budget.containers > 100_000) throw new CompactionInputError("required analysis container limit exceeded", "required_analysis_overflow");
      const keys = Object.keys(current);
      const record = current as Record<string, unknown>;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        values.push(key, record[key]); depths.push(depth + 1, depth + 1);
      }
    }
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function checkpointDigest(value: ResumeCheckpointV1): string { assertStructuralBounds(value); return digest(canonicalJson(value)); }
function invalid(): never { throw new CompactionInputError("invalid v13 checkpoint state", "invalid_checkpoint"); }
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
function sourceValid(value: unknown): value is CheckpointSourceReference {
  if (!value || typeof value !== "object") return false;
  const s = value as CheckpointSourceReference;
  return typeof s.entryId === "string" && !!s.entryId && /^[a-f0-9]{64}$/.test(s.contentDigest) &&
    ["user","bash","agent-declaration","tool-observation","legacy"].includes(s.sourceKind) &&
    [s.messageIndex,s.blockIndex,s.start,s.end].every(n => n === undefined || (Number.isSafeInteger(n) && n! >= 0)) &&
    (s.start === undefined || s.end === undefined || s.end >= s.start);
}
export function validateCheckpoint(value: unknown, expectedDigest?: string): ResumeCheckpointV1 {
  assertStructuralBounds(value);
  if (!value || typeof value !== "object") return invalid();
  const c = value as ResumeCheckpointV1;
  const keys = ["version","objective","files","tasks","pins","constraints","decisions","preconditions","evidence","risks","failures","omittedResolvedFailures","predecessor","updateEntryId"];
  if (Object.keys(c).some(key=>!keys.includes(key)) || keys.some(key=>!(key in c))) return invalid();
  if (!c.files || !strings(c.files.read) || !strings(c.files.modified)) return invalid();
  if (c.version !== 1 || typeof c.objective !== "string" || !Array.isArray(c.tasks) || !Array.isArray(c.pins) || c.pins.length > 32 ||
      !strings(c.constraints) || !Array.isArray(c.decisions) || !Array.isArray(c.preconditions) || !strings(c.risks) || !Array.isArray(c.failures) ||
      !Number.isSafeInteger(c.omittedResolvedFailures) || c.omittedResolvedFailures < 0 || !(c.updateEntryId === null || typeof c.updateEntryId === "string")) return invalid();
  if (c.predecessor !== null && (!c.predecessor || !/^[a-f0-9]{64}$/.test(c.predecessor.checkpointDigest) || !(c.predecessor.entryId === null || typeof c.predecessor.entryId === "string"))) return invalid();
  const resolutionValid = (r: CheckpointResolution | undefined): boolean => r === undefined || (!!r && typeof r.reason === "string" && !!r.reason && (r.replacement === undefined || typeof r.replacement === "string"));
  const ids = new Set<string>();
  for (const t of c.tasks) {
    if (!t || typeof t.id !== "string" || !t.id || ids.has(t.id) || !["pending","blocked","done"].includes(t.status) || typeof t.action !== "string" || typeof t.blocker !== "string" || !strings(t["depends-on"]) || !strings(t.requires) || (t.source && !sourceValid(t.source))) return invalid();
    if (!resolutionValid(t.resolution) || new Set(t.requires).size !== t.requires.length || new Set(t["depends-on"]).size !== t["depends-on"].length) return invalid();
    ids.add(t.id);
  }
  for (const pin of c.pins) {
    if (!pin || typeof pin.id !== "string" || !pin.id || ids.has(pin.id) || !["workset","constraint","request"].includes(pin.purpose) || typeof pin.text !== "string" || codePointLength(pin.text) > 2048 || !sourceValid(pin.source) || !["active","resolved","superseded"].includes(pin.status)) return invalid();
    if (!resolutionValid(pin.resolution) || (pin.status !== "active" && !pin.resolution)) return invalid();
    ids.add(pin.id);
  }
  const edges = new Map<string,string>();
  for (const item of [...c.tasks,...c.pins]) if (item.resolution?.replacement) {
    const replacement = item.resolution.replacement;
    if (("purpose" in item ? !c.pins.some(pin=>pin.id===replacement) : !c.tasks.some(task=>task.id===replacement))) return invalid();
    edges.set(item.id,replacement);
  }
  for (const id of edges.keys()) { const seen=new Set<string>(); let current:string|undefined=id; while(current!==undefined) { if(seen.has(current)) return invalid(); seen.add(current); current=edges.get(current); } }
  const predicates = new Set<string>();
  for (const p of c.preconditions) {
    if (!p || typeof p.id !== "string" || predicates.has(p.id) || typeof p.cwd !== "string" || (p.kind === "file-read-succeeded" ? typeof p.path !== "string" : p.kind !== "verification-pass" || typeof p.command !== "string" || typeof p.runner !== "string")) return invalid();
    predicates.add(p.id);
  }
  const taskIds = new Set(c.tasks.map(t => t.id));
  for (const t of c.tasks) if (t["depends-on"].some(id => !taskIds.has(id)) || t.requires.some(id => !predicates.has(id))) return invalid();
  const visiting = new Set<string>(), complete = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) invalid(); if (complete.has(id)) return; visiting.add(id); for (const next of c.tasks.find(t => t.id === id)!["depends-on"]) visit(next); visiting.delete(id); complete.add(id); };
  for (const id of taskIds) visit(id);
  for (const d of c.decisions) if (!d || typeof d.id !== "string" || typeof d.text !== "string" || typeof d.rationale !== "string") return invalid();
  const e = c.evidence;
  if (!e || !Number.isSafeInteger(e.mutationEpoch) || e.mutationEpoch < 0 || !Array.isArray(e.fileReads) || !Array.isArray(e.verification) || !strings(e.modifiedPaths)) return invalid();
  if (e.pendingMutations !== undefined && (!Array.isArray(e.pendingMutations) || e.pendingMutations.some(call => !call || typeof call.name !== "string" || call.potentiallyModifying !== true || (call.callId !== undefined && typeof call.callId !== "string") || (call.args !== undefined && (!call.args || typeof call.args !== "object" || Array.isArray(call.args)))))) return invalid();
  for (const r of e.fileReads) if (!r || typeof r.id !== "string" || typeof r.path !== "string" || typeof r.runner !== "string" || !["succeeded","failed","incomplete"].includes(r.status) || !Number.isSafeInteger(r.mutationEpoch) || r.mutationEpoch < 0 || r.mutationEpoch > e.mutationEpoch || (r.cwd !== undefined && typeof r.cwd !== "string") || typeof r.freshnessEstablished !== "boolean" || !strings(r.imports)) return invalid();
  for (const r of e.verification) if (!r || typeof r.id !== "string" || typeof r.tool !== "string" || typeof r.command !== "string" || typeof r.evidence !== "string" || !["PASS","FAIL","SKIP","INCOMPLETE"].includes(r.status) || !Number.isSafeInteger(r.mutationEpoch) || r.mutationEpoch < 0 || r.mutationEpoch > e.mutationEpoch || (r.cwd !== undefined && typeof r.cwd !== "string") || (r.freshnessEstablished !== undefined && typeof r.freshnessEstablished !== "boolean")) return invalid();
  for (const f of c.failures) if (!f || ![f.id,f.objective,f.signature,f.attemptedFix,f.observedOutcome].every(v => typeof v === "string") || !Array.isArray(f.sources) || !f.sources.every(sourceValid) || !(f.resolution === null || typeof f.resolution === "string") || !Number.isSafeInteger(f.occurrences) || f.occurrences < 1) return invalid();
  if (c.failures.filter(f=>f.resolution!==null).length > 10) return invalid();
  let stringCost = 0;
  const stringsToCount: unknown[] = [c];
  while (stringsToCount.length) { const item = stringsToCount.pop(); if (typeof item === "string") stringCost += codePointLength(item); else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) stringsToCount.push(key, child); if (stringCost > 65_536) throw new CompactionInputError("protected checkpoint exceeds 65,536 code points", "protected_overflow"); }
  const wire = canonicalJson(c);
  if (codePointLength(wire) > 65_536) throw new CompactionInputError("protected checkpoint exceeds 65,536 code points", "protected_overflow");
  if (expectedDigest !== undefined && digest(wire) !== expectedDigest) throw new CompactionInputError("checkpoint digest mismatch", "invalid_checkpoint");
  return JSON.parse(wire) as ResumeCheckpointV1;
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
/** Recover only compiler-generated tool invocations whose original signature proves provenance. */
export function failureInvocation(f: Pick<CheckpointFailure, "signature" | "attemptedFix" | "observedOutcome">): string | undefined {
  if (digest(`${f.attemptedFix}\0${f.observedOutcome}`) !== f.signature) return undefined;
  const match = /^([^:]+): (\{[\s\S]*\})$/.exec(f.attemptedFix);
  if (!match) return undefined;
  try {
    const args: unknown = JSON.parse(match[2]);
    if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args) !== match[2]) return undefined;
    return `${match[1]}: ${canonicalJson(args)}`;
  } catch { return undefined; }
}
const verificationKey = (r: ObservationSnapshot["verification"][number]) => `${r.tool}\0${r.command}\0${r.cwd ?? ""}`;
const verificationSignature = (r: ObservationSnapshot["verification"][number]) => digest(`${verificationKey(r)}\0${r.evidence}`);
const RESOLVED_BY_SUCCESS = "resolved: later success with same invocation";
const RETIRED_NOT_REOBSERVED = "retired: not re-observed in compaction input";
/** Missing declarations and prose cannot retire existing declared work. */
export function buildCheckpoint(previous: ResumeCheckpointV1 | undefined, declarations: ParsedStructuredDistillHandoff | ParsedStructuredDistillHandoff[] | undefined, observations: ObservationSnapshot, entryId?: string, files?: { read: string[]; modified: string[] }, sources?: Array<CheckpointSourceReference | undefined>, risks: string[] = [], failures: Array<Omit<CheckpointFailure, "objective" | "id" | "occurrences" | "resolution">> = [], successfulInvocations?: ReadonlySet<string>): ResumeCheckpointV1 {
  const c = previous ? validateCheckpoint(previous) : emptyCheckpoint();
  let omittedFiles = 0;
  if (files) {
    const read = [...new Set([...c.files.read, ...files.read])], modified = [...new Set([...c.files.modified, ...files.modified])];
    omittedFiles = Math.max(0,read.length-50)+Math.max(0,modified.length-50);
    c.files = {read:read.slice(-50),modified:modified.slice(-50)};
  }
  if (previous) c.predecessor = { checkpointDigest: checkpointDigest(previous), entryId: entryId ?? null };
  for (const [index, handoff] of (!declarations ? [] : Array.isArray(declarations) ? declarations : [declarations]).entries()) {
    c.objective = handoff.objective;
    if ("tasks" in handoff) {
      for (const incoming of handoff.tasks) {
        const old = c.tasks.find(t => t.id === incoming.id);
        if (!old) c.tasks.push({ ...incoming, ...(sources?.[index] ? { source: sources[index] } : {}), "depends-on": [...incoming["depends-on"]], requires: "requires" in incoming ? [...incoming.requires as string[]] : [] });
        else if (!old.resolution) { if (old.action !== incoming.action || old["depends-on"].join("\0") !== incoming["depends-on"].join("\0") || old.requires.join("\0") !== ("requires" in incoming ? (incoming.requires as string[]).join("\0") : "")) throw new CompactionInputError(`conflicting declaration ID ${incoming.id}`, "invalid_checkpoint"); old.blocker = incoming.blocker; if (incoming.status !== "done") old.status = incoming.status; }
      }
      for (const action of handoff["verification-needed"]) { const id=`verification-${digest(action).slice(0,16)}`; if (!c.tasks.some(t=>t.id===id)) c.tasks.push({id,status:"pending",action,"depends-on":[],blocker:"",requires:[],...(sources?.[index]?{source:sources[index]}:{})}); }
      for (const h of handoff["rejected-hypotheses"]) { const signature=digest(`${h.claim}\0${h.evidence}`); if (!c.failures.some(f=>f.signature===signature)) c.failures.push({id:h.id,objective:c.objective,signature,attemptedFix:h.claim,observedOutcome:h.evidence,sources:sources?.[index]?[sources[index]!]:[],resolution:"rejected hypothesis",occurrences:1}); }
      for (const s of handoff.invariants) if (!c.constraints.includes(s)) c.constraints.push(s);
      for (const d of handoff.decisions) if (!c.decisions.some(old => old.id === d.id)) c.decisions.push({...d});
      if ("preconditions" in handoff) for (const p of handoff.preconditions) { const old = c.preconditions.find(old => old.id === p.id); if (old && canonicalJson(old) !== canonicalJson(p)) throw new CompactionInputError(`conflicting precondition ID ${p.id}`, "invalid_checkpoint"); if (!old) c.preconditions.push({...p}); }
    } else {
      for (const action of [...handoff.next,...handoff["verification-needed"]]) { const id = `legacy-${digest(action).slice(0,16)}`; if (!c.tasks.some(t=>t.id===id)) c.tasks.push({id,status:"pending",action,"depends-on":[],blocker:"",requires:[],...(sources?.[index] ? {source:sources[index]} : {})}); }
      for (const decision of handoff.decision) if (!c.decisions.some(d=>d.text===decision)) c.decisions.push({id:`decision-${digest(decision).slice(0,16)}`,text:decision,rationale:"agent declaration"});
      for (const risk of handoff.blocker) if (!c.risks.includes(risk)) c.risks.push(risk);
    }
  }
  for (const risk of risks) if (!c.risks.includes(risk)) c.risks.push(risk);
  // Failure retirement evidence: carried records with no fresh occurrence retire;
  // a later successful invocation with the same identity resolves its failure.
  const carriedUnresolved = new Set(previous ? previous.failures.filter(f=>f.resolution===null).map(f=>f.signature) : []);
  const failedVerifications = new Map<string,string>();
  // Carried failures retain their exact identity through their protected FAIL receipts.
  for (const r of [...c.evidence.verification, ...observations.verification])
    if (r.status === "FAIL") failedVerifications.set(verificationSignature(r), verificationKey(r));
  const freshFailureSignatures = new Set(failures.map(f=>f.signature));
  const offset = c.evidence.mutationEpoch;
  c.evidence = { mutationEpoch: offset + observations.mutationEpoch,
    pendingMutations: observations.pendingMutations?.map(call=>({...call})),
    fileReads: [...c.evidence.fileReads,...observations.fileReads.map(r=>({...r, mutationEpoch: r.mutationEpoch + offset}))],
    verification: [...c.evidence.verification,...observations.verification.map(r=>({...r,mutationEpoch:r.mutationEpoch+offset}))],
    modifiedPaths: [...new Set([...c.evidence.modifiedPaths,...observations.modifiedPaths])] };
  for (const r of observations.verification.filter(r=>r.status==="FAIL")) {
    const signature = digest(`${r.tool}\0${r.command}\0${r.cwd ?? ""}\0${r.evidence}`);
    const old = c.failures.find(f=>f.signature===signature && f.resolution===null);
    if (old) old.occurrences++; else c.failures.push({id:`failure-${signature.slice(0,16)}`,objective:c.objective,signature,attemptedFix:"",observedOutcome:r.evidence,sources:[],resolution:null,occurrences:1});
  }
  for (const failure of failures) {
    const old = c.failures.find(f=>f.signature===failure.signature && f.resolution===null);
    if (old) old.occurrences++; else c.failures.push({...failure,id:`failure-${failure.signature.slice(0,16)}`,objective:c.objective,resolution:null,occurrences:1});
  }
  for (const f of c.failures) {
    if (f.resolution !== null) continue;
    const verificationIdentity = failedVerifications.get(f.signature);
    if (verificationIdentity !== undefined) {
      const latest = observations.verification.findLast(r => verificationKey(r) === verificationIdentity);
      const failureIndex = observations.verification.findLastIndex(r => verificationSignature(r) === f.signature && r.status === "FAIL");
      const latestIndex = latest ? observations.verification.lastIndexOf(latest) : -1;
      if (latest?.status === "PASS" && latest.cwd && isAbsolute(latest.cwd) && latest.freshnessEstablished === true &&
          latest.mutationEpoch === observations.mutationEpoch && !observations.pendingMutations?.length && latestIndex > failureIndex) {
        f.resolution = RESOLVED_BY_SUCCESS;
      } else if (!latest && carriedUnresolved.has(f.signature)) f.resolution = RETIRED_NOT_REOBSERVED;
      continue;
    }
    // Receipt-less legacy verification failures cannot acquire a guessed invocation identity.
    if (!f.attemptedFix) continue;
    const invocation = failureInvocation(f);
    if (invocation && successfulInvocations?.has(invocation)) { f.resolution = RESOLVED_BY_SUCCESS; continue; }
    if (carriedUnresolved.has(f.signature) && !freshFailureSignatures.has(f.signature)) f.resolution = RETIRED_NOT_REOBSERVED;
  }
  const resolved = c.failures.filter(f=>f.resolution!==null);
  if (resolved.length>10) { const drop = new Set(resolved.slice(0,-10)); c.failures=c.failures.filter(f=>!drop.has(f)); c.omittedResolvedFailures+=drop.size; }
  const requiredRead = (r: ObservationSnapshot["fileReads"][number]) => c.preconditions.some(p=>p.kind === "file-read-succeeded" && p.cwd === r.cwd && pathIdentity(p.path,p.cwd) === pathIdentity(r.path,r.cwd));
  const requiredVerification = (r: ObservationSnapshot["verification"][number]) => c.failures.some(f => f.resolution === null && r.status === "FAIL" && verificationSignature(r) === f.signature) || c.preconditions.some(p=>p.kind === "verification-pass" && p.cwd === r.cwd && p.runner === r.tool && p.command === r.command);
  const reads = c.evidence.fileReads.filter((r,i,a)=>requiredRead(r) || i>=a.length-50);
  const verification = c.evidence.verification.filter((r,i,a)=>requiredVerification(r) || i>=a.length-50);
  const omissionPrefix = "Optional checkpoint records omitted: ";
  let omitted = omittedFiles + c.evidence.fileReads.length - reads.length + c.evidence.verification.length - verification.length;
  omitted += Number(c.risks.find(r=>r.startsWith(omissionPrefix))?.slice(omissionPrefix.length) ?? 0);
  c.evidence = {...c.evidence,fileReads:reads,verification};
  // Optional inventories and observations are bounded whole records; omissions are attributed.
  for (;;) {
    c.risks = c.risks.filter(r=>!r.startsWith(omissionPrefix));
    if (omitted) c.risks.push(`${omissionPrefix}${omitted}`);
    try { return freeze(validateCheckpoint(c)); }
    catch (error) {
      if (!(error instanceof CompactionInputError) || error.code !== "protected_overflow") throw error;
      omitted++;
      // Entire optional records are evicted before required identities and declarations.
      const read = reads.findIndex(r=>!requiredRead(r));
      const check = verification.findIndex(r=>!requiredVerification(r));
      if (c.files.read.length) c.files.read.shift();
      else if (c.files.modified.length) c.files.modified.shift();
      else if (read>=0) reads.splice(read,1);
      else if (check>=0) verification.splice(check,1);
      else if (c.evidence.modifiedPaths.length) c.evidence={...c.evidence,modifiedPaths:c.evidence.modifiedPaths.slice(1)};
      else throw error;
    }
  }
}
export function checkpointReadyTasks(c: ResumeCheckpointV1): string[] {
  const states=evaluatePreconditions(c.preconditions,c.evidence);
  return c.tasks.filter(t=>t.status==="pending" && t["depends-on"].every(id=>c.tasks.find(d=>d.id===id)?.status==="done") && t.requires.every(id=>states.get(id)==="satisfied")).map(t=>t.id);
}
export function renderCheckpoint(c: ResumeCheckpointV1): string {
  if (!c.objective && !c.tasks.length && !c.pins.length && !c.constraints.length && !c.decisions.length && !c.risks.length && !c.failures.length && !c.omittedResolvedFailures) return "";
  const escape=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const states=evaluatePreconditions(c.preconditions,c.evidence), ready=checkpointReadyTasks(c);
  const lines=["<checkpoint-v1>",`objective: ${escape(c.objective)}`];
  for (const pin of c.pins.filter(p=>p.status==="active")) lines.push(`pin ${escape(pin.id)} (${pin.purpose}; source=${escape(pin.source.entryId)}): ${escape(pin.text)}`);
  for (const constraint of c.constraints) lines.push(`constraint: ${escape(constraint)}`);
  for (const d of c.decisions) lines.push(`decision ${escape(d.id)}: ${escape(d.text)}; rationale: ${escape(d.rationale)}`);
  for (const t of c.tasks) {
    const unmet=t.requires.filter(id=>states.get(id)!=="satisfied");
    if (t.status!=="done" || unmet.length) lines.push(`task ${escape(t.id)} [declared ${t.status}${ready.includes(t.id)?"; ready":""}]: ${escape(t.action)}; depends-on=${escape(t["depends-on"].join(","))}; requires=${escape(t.requires.join(","))}${unmet.length?`; unmet=${escape(unmet.join(","))}`:""}${t.blocker?`; blocker=${escape(t.blocker)}`:""}`);
  }
  const requiredIds = new Set(c.tasks.filter(t => t.status !== "done" || t.requires.some(id => states.get(id) !== "satisfied")).flatMap(t => t.requires));
  for (const p of c.preconditions.filter(p => requiredIds.has(p.id))) lines.push(`precondition ${escape(p.id)} [${states.get(p.id) ?? "unknown"}]: ${p.kind === "verification-pass" ? `runner=${escape(p.runner)}; command=${escape(p.command)}` : `path=${escape(p.path)}`}; cwd=${escape(p.cwd)}`);
  for (const f of c.failures.filter(f=>f.resolution===null)) lines.push(`failure ${escape(f.id)} (${f.occurrences}): objective=${escape(f.objective)}; fix=${escape(f.attemptedFix)}; outcome=${escape(f.observedOutcome)}; signature=${escape(f.signature)}; sources=${escape(f.sources.map(s=>s.entryId).join(","))}`);
  const resolvedBySuccess = c.failures.filter(f=>f.resolution===RESOLVED_BY_SUCCESS).length;
  const retiredFailures = c.failures.filter(f=>f.resolution===RETIRED_NOT_REOBSERVED).length;
  if (resolvedBySuccess || retiredFailures || c.omittedResolvedFailures) lines.push(`auto-resolved failures: ${resolvedBySuccess} by later success; ${retiredFailures} retired as not re-observed; ${c.omittedResolvedFailures} omitted historical`);
  for (const risk of c.risks) lines.push(`risk: ${escape(risk)}`);
  lines.push("</checkpoint-v1>");
  const rendered=lines.join("\n");
  if (codePointLength(rendered)>65_536) throw new CompactionInputError("protected rendered checkpoint overflow","protected_overflow");
  return rendered;
}
