import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform, release } from "node:os";
import { isDeepStrictEqual } from "node:util";

export const TRACE_SCHEMA_VERSION = "2.1" as const;
export const REDACTED = "[REDACTED]";

export type TraceSource = "simulation" | "screen-reader" | "runner" | "browser-diagnostic" | "verifier" | "policy";
export type TraceEventType = string;
export interface CollectionWindow { startedAt: string; endedAt: string }
export interface TraceEvent {
  id: string;
  /** Recorder order, not an assertion about the order in which speech was produced. */
  seq: number;
  timestamp: string;
  type: TraceEventType;
  source: TraceSource;
  commandId?: string;
  collectionWindow?: CollectionWindow;
  /** A collected utterance is not proof that this command caused the speech. */
  association?: "temporal-only";
  data: unknown;
  redacted: boolean;
}
export interface TraceEnvironment {
  platform: string;
  platformVersion: string;
  browser: string;
  browserVersion: string;
  screenReader: string;
  screenReaderVersion: string;
  [key: string]: unknown;
}
export interface TraceTaskMetadata {
  id: string;
  mode?: "screenreader" | "keyboard";
  url?: string;
  goal?: string;
  input?: unknown;
  inputs?: unknown;
}
export interface RunOutcome {
  status: "success" | "failure" | "inconclusive" | "aborted";
  reason?: string;
  [key: string]: unknown;
}
export interface RunTrace {
  schemaVersion: "2.0" | typeof TRACE_SCHEMA_VERSION;
  runId: string;
  task: TraceTaskMetadata;
  environment: TraceEnvironment;
  startedAt: string;
  endedAt?: string;
  events: TraceEvent[];
  outcome?: RunOutcome;
  privacy: {
    inputValues: "redacted" | "included-by-explicit-opt-in";
    redactionApplied: boolean;
  };
}
export interface TraceRecorderOptions {
  environment?: Partial<TraceEnvironment>;
  sensitiveValues?: string[];
  /** Opt-in also exposes values to any subsequently selected analyzer plugin. */
  includeSensitiveInputValues?: boolean;
  runId?: string;
}
export interface AppendEventOptions {
  source?: TraceSource;
  commandId?: string;
  collectionWindow?: CollectionWindow;
  timestamp?: string;
  /** Caller removed sensitive fragments that cannot be matched as whole input values. */
  redacted?: boolean;
}

function jsonCopy<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Trace payload must be JSON serializable.");
  return JSON.parse(serialized) as T;
}

function inputStrings(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(inputStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(inputStrings);
  return [];
}

/** Redacts before persistence and before downstream analyzer access. No secret map is saved. */
export function createRedactor(values: readonly string[]): <T>(value: T) => { value: T; redacted: boolean } {
  const secrets = [...new Set(values.filter(Boolean).flatMap((value) => [value, encodeURIComponent(value), new URLSearchParams({ value }).toString().slice(6), JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
  const pattern = secrets.length ? new RegExp(secrets.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : undefined;
  return <T>(input: T): { value: T; redacted: boolean } => {
    let redacted = false;
    const text = (value: string): string => pattern ? value.replace(pattern, () => { redacted = true; return REDACTED; }) : value;
    const walk = (value: unknown): unknown => {
      if (typeof value === "string") return text(value);
      // Task inputs are strings. Numeric protocol IDs/counts and boolean outcomes
      // remain typed metadata even when an input string is '1' or 'true'.
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === "object") {
        // Property names are schema, not input values. Replacing a short input such as
        // 'id' in every key would destroy the trace's structure and evidence references.
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
      }
      return value;
    };
    return { value: walk(jsonCopy(input)) as T, redacted };
  };
}

function sourceFor(type: string): TraceSource {
  if (/^simulation[.:-]/.test(type)) return "simulation";
  if (/^(screen-reader|screenreader|sr)[.:-]/.test(type)) return "screen-reader";
  if (/^(browser|diagnostic)[.:-]/.test(type)) return "browser-diagnostic";
  if (/^(verify|verifier)[.:-]/.test(type)) return "verifier";
  if (/^policy[.:-]/.test(type)) return "policy";
  return "runner";
}

/** Restore only known structural fields; arbitrary raw text is never exempted. */
const RUN_STAGES = ['initialization', 'backend-start', 'browser-start', 'observation', 'policy', 'action', 'settling', 'verification'];
const OUTCOME_REASONS = ['verified', 'verification-failed', 'policy-stuck', 'maxSteps', 'timeout', 'error', 'aborted', 'trace-persistence-error', 'policy-uncertain', 'unsupported-profile', 'access-blocked', 'unsupported-pattern'];
function preserveRunPoint(original: Record<string, unknown>, target: Record<string, unknown>): void {
  if (typeof original.stage === 'string' && RUN_STAGES.includes(original.stage)) target.stage = original.stage;
  if (typeof original.step === 'number') target.step = original.step;
  if (['SIGINT', 'SIGTERM', 'requested'].includes(String(original.signal))) target.signal = original.signal;
}
function preserveEventStructure(type: string, original: unknown, redacted: unknown): void {
  if (!record(original) || !record(redacted)) return;
  const copy = (source: Record<string, unknown>, target: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) if (Object.hasOwn(source, key) && source[key] !== undefined) target[key] = jsonCopy(source[key]);
  };
  const output = (source: unknown, target: unknown) => {
    if (record(source) && record(target)) copy(source, target, ["sequence", "receivedAt", "windowId"]);
  };
  const observation = (source: unknown, target: unknown) => {
    if (!record(source) || !record(target)) return;
    copy(source, target, ["kind", "provenance", "windowId", "startedAt", "endedAt", "commandIds", "outputEventIds", "association", "attribution", "speechComplete"]);
    if (record(source.window) && record(target.window)) copy(source.window, target.window, ["id", "startedAt", "endedAt", "reason"]);
    if (Array.isArray(source.outputs) && Array.isArray(target.outputs)) {
      source.outputs.forEach((item, index) => output(item, (target.outputs as unknown[])[index]));
    }
  };
  if (type.startsWith("backend.")) {
    copy(original, redacted, ["type", "commandId", "sequence", "timestamp", "windowId"]);
    output(original.output, redacted.output);
    observation(original.observation, redacted.observation);
    if (record(original.raw) && record(redacted.raw) && typeof original.raw.id === "number") {
      redacted.raw.id = original.raw.id;
    }
  }
  if (type === "environment.updated" && record(original.environment) && record(redacted.environment) && ['native','simulation','keyboard','unspecified'].includes(String(original.environment.observationProvenance))) redacted.environment.observationProvenance = original.environment.observationProvenance;
  if (type === "backend.metadata") {
    copy(original, redacted, ["backend", "profile", "evidenceProvenance", "observationProvenance"]);
    if (record(original.capabilities) && record(redacted.capabilities)) copy(original.capabilities, redacted.capabilities, ["intents", "keys", "textEntry", "replaceText"]);
    if (record(original.collection) && record(redacted.collection)) copy(original.collection, redacted.collection, ["quietMs", "maxWaitMs", "attribution", "speechCompletionSignal"]);
  }
  if (type === "run.started" && record(original.allowedActions) && record(redacted.allowedActions)) copy(original.allowedActions, redacted.allowedActions, ["intents", "keys", "inputKeys", "replaceText"]);
  if (type === "screen-reader.output" || type === "simulation.output") output(original, redacted);
  if (type === "screen-reader.observation" || type === "simulation.observation" || type === "keyboard.observation") observation(original, redacted);
  if (type === "keyboard.observation") {
    // PNG bytes cannot be meaningfully redacted with string substitution. The runner
    // suppresses entire visual observations after input; pre-input pixels are explicit
    // legacy visual evidence and are not claimed to be anonymized.
    for (const field of ["screenshot", "previousScreenshot"]) {
      if (record(original[field]) && record(redacted[field])) {
        const source = original[field] as Record<string, unknown>;
        const target = redacted[field] as Record<string, unknown>;
        if (typeof source.pngBase64 === "string" && /^[A-Za-z0-9+/=]+$/.test(source.pngBase64) && Buffer.from(source.pngBase64, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a") copy(source, target, ["pngBase64", "viewport"]);
      }
    }
  }
  if (["run.error", "run.aborted"].includes(type)) preserveRunPoint(original, redacted);
  if (["policy.decision", "policy.rejected", "action.result", "verifier.result", "verifier.evidence"].includes(type)) copy(original, redacted, ["step"]);
  if (type === "policy.rejected" && original.reasonCode === "action-not-allowed") redacted.reasonCode = original.reasonCode;
  if (type === "verifier.evidence") {
    copy(original, redacted, ["ruleIndex", "ruleType", "passed"]);
    if (record(original.witness) && record(redacted.witness)) {
      copy(original.witness, redacted.witness, ["kind", "provenance", "outputEventIds", "activationStep", "association", "timestamp", "textSource"]);
      if (record(original.witness.window) && record(redacted.witness.window)) copy(original.witness.window, redacted.witness.window, ["id", "startedAt", "endedAt", "reason"]);
    }
  }
  if (type === "verifier.result" && Array.isArray(original.rules) && Array.isArray(redacted.rules)) {
    original.rules.forEach((rule, index) => {
      const target = (redacted.rules as unknown[])[index];
      if (record(rule) && record(target)) copy(rule, target, ["ruleIndex", "ruleType", "passed", "evidenceEventIds"]);
    });
  }
  if (type === "policy.decision" && record(original.decision) && record(redacted.decision)) {
    copy(original.decision, redacted.decision, ["stop"]);
    if (["model", "exploration-guard"].includes(String(original.decision.stopSource))) redacted.decision.stopSource = original.decision.stopSource;
  }
  const action = type === "policy.decision" && record(original.decision) ? original.decision.action : type === "action.result" ? original.action : undefined;
  const safeAction = type === "policy.decision" && record(redacted.decision) ? redacted.decision.action : type === "action.result" ? redacted.action : undefined;
  if (record(action) && record(safeAction)) copy(action, safeAction, ["kind", "input", "intent", "key"]);
}

export class TraceRecorder {
  private readonly state: RunTrace;
  private readonly redact: ReturnType<typeof createRedactor>;
  private initialized = false;
  private finalized = false;
  private finalizing = false;

  constructor(task: TraceTaskMetadata, readonly outDir: string, options: TraceRecorderOptions = {}) {
    if (!task.id) throw new Error("Trace task id is required.");
    const include = options.includeSensitiveInputValues === true;
    this.redact = createRedactor(include ? [] : [
      ...inputStrings(task.input), ...inputStrings(task.inputs), ...(options.sensitiveValues ?? [])
    ]);
    const safeTask = this.redact(task);
    if (task.mode === "screenreader" || task.mode === "keyboard") safeTask.value.mode = task.mode;
    const safeEnvironment = this.redact<TraceEnvironment>({
      // AT Driver can target another host. Do not claim the recorder OS is the AT host.
      platform: "unknown", platformVersion: "unknown", browser: "unknown", browserVersion: "unknown",
      screenReader: "unknown", screenReaderVersion: "unknown",
      recorderPlatform: platform(), recorderPlatformVersion: release(), ...options.environment
    });
    if (['native','simulation','keyboard','unspecified'].includes(String(options.environment?.observationProvenance))) safeEnvironment.value.observationProvenance = options.environment!.observationProvenance;
    this.state = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: options.runId ?? randomUUID(),
      task: safeTask.value,
      environment: safeEnvironment.value,
      startedAt: new Date().toISOString(),
      events: [],
      privacy: {
        inputValues: include ? "included-by-explicit-opt-in" : "redacted",
        redactionApplied: safeTask.redacted || safeEnvironment.redacted
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.outDir, { recursive: true });
    // A reused output directory must never silently replace a previous run.
    await writeFile(join(this.outDir, "trace.json"), JSON.stringify(this.state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(join(this.outDir, "trace.jsonl"), "", { flag: "wx", mode: 0o600 });
    this.initialized = true;
  }

  append(type: TraceEventType, data: unknown, options: AppendEventOptions = {}): TraceEvent {
    if (!this.initialized) throw new Error("Initialize the trace before appending events.");
    if (this.finalized || this.finalizing) throw new Error("Cannot append to a finalized trace.");
    if (typeof type !== "string" || !type.trim()) throw new Error("Event type is required.");
    const source = options.source ?? sourceFor(type);
    const safe = this.redact(data);
    preserveEventStructure(type, data, safe.value);
    const seq = this.state.events.length + 1;
    const event: TraceEvent = {
      id: `event-${String(seq).padStart(6, "0")}`,
      seq,
      timestamp: options.timestamp ?? new Date().toISOString(),
      type,
      source,
      data: safe.value,
      ...(options.commandId !== undefined ? { commandId: options.commandId } : {}),
      ...(options.collectionWindow ? { collectionWindow: jsonCopy(options.collectionWindow) } : {}),
      ...((source === "screen-reader" || source === "simulation") && options.commandId ? { association: "temporal-only" as const } : {}),
      redacted: !isDeepStrictEqual(jsonCopy(data), safe.value) || options.redacted === true
    };
    validateEvent(event, seq);
    // Append before exposing the event; no merge, trim, deduplication, or causal inference.
    appendFileSync(join(this.outDir, "trace.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 });
    this.state.events.push(event);
    this.state.privacy.redactionApplied ||= event.redacted;
    return jsonCopy(event);
  }

  /** A detached, already-redacted copy, safe to pass across the analyzer boundary. */
  snapshot(): RunTrace { return jsonCopy(this.state); }

  /** Backends often learn versions only after startup. Keep that update in the journal too. */
  updateEnvironment(fields: Partial<TraceEnvironment>, options: Pick<AppendEventOptions, "redacted"> = {}): TraceEvent {
    const environment = { ...this.state.environment, ...fields };
    validateTrace({ ...this.state, environment });
    const event = this.append("environment.updated", { environment }, { source: "runner", redacted: options.redacted });
    this.state.environment = jsonCopy((event.data as { environment: TraceEnvironment }).environment);
    return event;
  }

  async finalize(outcome: RunOutcome): Promise<RunTrace> {
    if (!this.initialized) throw new Error("Initialize the trace before finalizing it.");
    if (this.finalized || this.finalizing) throw new Error("Trace has already been finalized.");
    const safeOutcome = this.redact(outcome);
    // Outcome status is a trusted enum, not free-form content. Inputs such as
    // 'success' must not make finalization invalid or change the recorded result.
    safeOutcome.value.status = outcome.status;
    if (typeof outcome.reason === 'string' && OUTCOME_REASONS.includes(outcome.reason)) safeOutcome.value.reason = outcome.reason;
    preserveRunPoint(outcome, safeOutcome.value);
    if (record(outcome.cancellation) && record(safeOutcome.value.cancellation)) preserveRunPoint(outcome.cancellation, safeOutcome.value.cancellation);
    if (["model", "exploration-guard"].includes(String(outcome.policyStopSource))) safeOutcome.value.policyStopSource = outcome.policyStopSource;
    if (outcome.policyStop === "success" || outcome.policyStop === "stuck" || outcome.policyStop === "uncertain") safeOutcome.value.policyStop = outcome.policyStop;
    const next: RunTrace = { ...this.state, endedAt: new Date().toISOString(), outcome: safeOutcome.value,
      privacy: { ...this.state.privacy, redactionApplied: this.state.privacy.redactionApplied || safeOutcome.redacted } };
    validateTrace(next);
    this.finalizing = true;
    try {
      await writeJsonAtomic(join(this.outDir, "trace.json"), next);
    } catch (error) {
      this.finalizing = false;
      throw error;
    }
    Object.assign(this.state, next);
    this.finalized = true;
    return this.snapshot();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function validateEvent(value: unknown, expectedSequence: number): asserts value is TraceEvent {
  if (!record(value) || value.seq !== expectedSequence || typeof value.id !== "string" || !value.id ||
      !validTimestamp(value.timestamp) || typeof value.type !== "string" || !value.type.trim() ||
      !["simulation", "screen-reader", "runner", "browser-diagnostic", "verifier", "policy"].includes(String(value.source)) ||
      typeof value.redacted !== "boolean" || !("data" in value)) {
    throw new Error(`Invalid trace event or event ordering at sequence ${expectedSequence}.`);
  }
  if (value.commandId !== undefined && (typeof value.commandId !== "string" || !value.commandId)) {
    throw new Error(`Invalid command id at sequence ${expectedSequence}.`);
  }
  if (value.association !== undefined && value.association !== "temporal-only") {
    throw new Error(`Unsupported speech association at sequence ${expectedSequence}.`);
  }
  if ((value.source === "screen-reader" || value.source === "simulation") && value.commandId && value.association !== "temporal-only") {
    throw new Error(`Speech association must be temporal-only at sequence ${expectedSequence}.`);
  }
  if (value.collectionWindow !== undefined) {
    const window = value.collectionWindow;
    if (!record(window) || !validTimestamp(window.startedAt) || !validTimestamp(window.endedAt) ||
        Date.parse(window.endedAt) < Date.parse(window.startedAt)) {
      throw new Error(`Invalid collection window at sequence ${expectedSequence}.`);
    }
  }
}

/** Fail closed on unknown schemas, corrupt order, duplicate IDs, or missing provenance. */
export function validateTrace(value: unknown): asserts value is RunTrace {
  if (!record(value) || !["2.0", TRACE_SCHEMA_VERSION].includes(String(value.schemaVersion))) throw new Error("Unsupported trace schema version; expected 2.0 or 2.1.");
  if (typeof value.runId !== "string" || !value.runId || !record(value.task) || typeof value.task.id !== "string" ||
      !value.task.id || !validTimestamp(value.startedAt) || !Array.isArray(value.events) || !record(value.environment)) {
    throw new Error("Invalid trace metadata.");
  }
  for (const key of ["platform", "platformVersion", "browser", "browserVersion", "screenReader", "screenReaderVersion"]) {
    if (typeof value.environment[key] !== "string" || !value.environment[key]) throw new Error(`Missing trace environment field: ${key}. Use 'unknown' when unavailable.`);
  }
  if (!record(value.privacy) || !["redacted", "included-by-explicit-opt-in"].includes(String(value.privacy.inputValues)) ||
      typeof value.privacy.redactionApplied !== "boolean") throw new Error("Invalid trace privacy metadata.");
  const ids = new Set<string>();
  value.events.forEach((event, index) => {
    validateEvent(event, index + 1);
    if (value.schemaVersion === "2.0" && event.source === "simulation") throw new Error("Simulation evidence requires trace schema 2.1.");
    if (ids.has(event.id)) throw new Error(`Duplicate evidence event id at sequence ${index + 1}.`);
    ids.add(event.id);
  });
  if (value.endedAt !== undefined && (!validTimestamp(value.endedAt) || Date.parse(value.endedAt) < Date.parse(value.startedAt))) {
    throw new Error("Invalid trace end timestamp.");
  }
  if (value.outcome !== undefined && (!record(value.outcome) || !["success", "failure", "inconclusive", "aborted"].includes(String(value.outcome.status)))) {
    throw new Error("Invalid trace run outcome.");
  }
  if ((value.endedAt === undefined) !== (value.outcome === undefined)) throw new Error("Finalized traces must include both end timestamp and outcome.");
}

export async function traceFilePath(pathOrOutDir: string): Promise<string> {
  return (await stat(pathOrOutDir)).isDirectory() ? join(pathOrOutDir, "trace.json") : pathOrOutDir;
}

export async function readTrace(pathOrOutDir: string): Promise<RunTrace> {
  const path = await traceFilePath(pathOrOutDir);
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  validateTrace(value);
  if (!value.endedAt) {
    // The append-only journal also survives an interrupted run before finalization.
    const journal = await readFile(join(dirname(path), "trace.jsonl"), "utf8");
    value.events = journal.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as TraceEvent);
    value.privacy.redactionApplied ||= value.events.some((event) => event.redacted);
    for (const event of value.events) {
      if (event.type === "environment.updated" && event.source === "runner" && record(event.data) && record(event.data.environment)) {
        value.environment = event.data.environment as TraceEnvironment;
      }
    }
    validateTrace(value);
  }
  return value;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}
