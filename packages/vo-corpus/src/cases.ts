import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A collection case: one small page and the chords pressed on it. Generators write cases; the runner presses them on a
 * live VoiceOver and the comparer replays them on the simulator. Speech is recorded per chord.
 *
 * Every page starts with a "Before marker" button and ends with an "After marker" button, and names are unique on the
 * page. Speech anchors help align the start; they do not independently observe the VoiceOver cursor. Failed starts
 * are retained in the planned denominator. The start protocol is recorded separately for each collection environment.
 */
export interface Case {
  /** Stable across regenerations: the same id always means the same page and chords. */
  id: string;
  /** Path of the page relative to the cases directory (the runner serves that directory). */
  page: string;
  /** Public live-page validation. Both browsers add the same two start/end markers. */
  url?: string;
  viewport?: { width: number; height: number };
  startProtocol?: "first-heading";
  contentProtocol?: "visible-dom-v1";
  /** Chords in session.ts notation, pressed in order after the start check. */
  chords: string[];
  /** Keep the observation window open for delayed page updates, independently of silence. */
  listen?: { minWaitMs?: number; quietMs?: number; maxWaitMs?: number };
  /** Save a native AX snapshot after each action, in addition to the initial page tree. */
  captureAxAfterSteps?: boolean;
  /** Frozen outcome targets, evaluated after execution; never supplied to the replay policy. */
  taskOutcome?: import("./task-outcomes.js").TaskOutcome;
  /** What the case covers, for coverage tables: e.g. { role: "checkbox", state: "checked", name: "label-wrap", command: "next" }. */
  axes: Record<string, string>;
}

export interface CaseSet {
  /** e.g. "elements-v1". Records name the set and its version. */
  id: string;
  generatedAt: string;
  /** Generated fixture text is public test data; production task inputs still default to sensitive. */
  syntheticInputs?: boolean;
  cases: Case[];
}

/** One case's result, from the live VoiceOver or the simulator. Written one per line to records.jsonl. */
export interface CaseRecord {
  caseSet: string;
  caseId: string;
  source: "voiceover" | "simulator";
  simulatorEnvironment?:{referenceBrowser:'safari'|'chrome';browser:{name:'chromium';version:string}};
  /** One collection attempt; a resumed partial case receives a different ID. */
  attemptId?: string;
  captureSessionId?: string;
  receiptClockOrigin?: string;
  /** Simulator coverage gap; kept separate from collection failures. */
  unsupportedReason?: string;
  pageContext?: import("./real-pages.js").PageContext;
  /** Speech after the start chord (VO+Home); aligned when it names START_MARKER. */
  start: { aligned: boolean; speech: string[]; commands?: string[]; axPath?: string; anchor?: { name: string; level?: number }; pageLoad?: import("./session.js").Heard;
    focusPreparation?:{method:'AXFocused';requestedAt:number;endedAt:number;error?:string} };
  steps: {
    chord: string; utterances: { t: number; text: string }[]; reason: "quiet" | "deadline" | "unsupported";
    /** Relative to the run directory. AX evidence is separate from speech and may arrive later. */
    axPath?: string;
    axError?: string;
    /** The action changed the front application; speech from this window cannot establish browser-profile fidelity. */
    foregroundError?: string;
    /** Last measured start/post-action tree before this action, not an instantaneous pre-action capture. */
    beforeAxPath?: string;
    /** Host receipt-clock milliseconds, sharing the origin used by utterances[].t. Not synthesis latency. */
    timing?: { requestedAt: number; acknowledgedAt: number; observationStartedAt: number; observationEndedAt: number;
      requestClock?: "wire-request-v1"; axObservationStartedAt?: number; axObservationEndedAt?: number };
    /** Generated-fixture DOM oracle, kept outside policy observations and speech scoring. */
    state?: import("./state.js").PageState;
  }[];
  /** Set when the case stopped early (connection lost, browser not in front); steps then holds what ran. */
  error?: string;
}

export const START_MARKER = "Before marker";
export const END_MARKER = "After marker";

/** An explicit capture subset is frozen before execution; absent legacy plans mean the complete case set. */
export function plannedCaseSet(set: CaseSet, ids?: unknown): CaseSet {
  if (ids === undefined) return set;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length || ids.some(id => !set.cases.some(c => c.id === id))) throw new Error("Invalid frozen capture case plan");
  const selected = new Set(ids);
  return { ...set, cases: set.cases.filter(c => selected.has(c.id)) };
}

/** Pins case metadata and local page bytes; a resumed run must use exactly the same fixture contents. */
export async function casesFingerprint(directory: string, set: CaseSet): Promise<string> {
  const hash = createHash("sha256").update(await readFile(join(directory, "cases.json")));
  for (const page of [...new Set(set.cases.map(c => c.page).filter(Boolean))].sort()) hash.update(page).update(await readFile(join(directory, page)));
  return hash.digest("hex");
}
