import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A collection case: one small page and the chords pressed on it. Generators write cases; the runner presses them on a
 * live VoiceOver and the comparer replays them on the simulator. Speech is recorded per chord.
 *
 * Every page starts with a "Before marker" button and ends with an "After marker" button, and names are unique on the
 * page, so the speech alone shows where the VoiceOver cursor is. The runner presses VO+Home first and checks that the
 * speech names "Before marker"; a case whose start check fails is recorded as misaligned, not as data.
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
  /** Chords in session.ts notation, pressed in order after the start check. */
  chords: string[];
  /** Keep the observation window open for delayed page updates, independently of silence. */
  listen?: { minWaitMs?: number; quietMs?: number; maxWaitMs?: number };
  /** Save a native AX snapshot after each action, in addition to the initial page tree. */
  captureAxAfterSteps?: boolean;
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
  /** Simulator coverage gap; kept separate from collection failures. */
  unsupportedReason?: string;
  pageContext?: import("./real-pages.js").PageContext;
  /** Speech after the start chord (VO+Home); aligned when it names START_MARKER. */
  start: { aligned: boolean; speech: string[]; commands?: string[]; axPath?: string; anchor?: { name: string; level?: number } };
  steps: {
    chord: string; utterances: { t: number; text: string }[]; reason: "quiet" | "deadline" | "unsupported";
    /** Relative to the run directory. AX evidence is separate from speech and may arrive later. */
    axPath?: string;
    axError?: string;
    /** Generated-fixture DOM oracle, kept outside policy observations and speech scoring. */
    state?: import("./state.js").PageState;
  }[];
  /** Set when the case stopped early (connection lost, browser not in front); steps then holds what ran. */
  error?: string;
}

export const START_MARKER = "Before marker";
export const END_MARKER = "After marker";

/** Pins case metadata and local page bytes; a resumed run must use exactly the same fixture contents. */
export async function casesFingerprint(directory: string, set: CaseSet): Promise<string> {
  const hash = createHash("sha256").update(await readFile(join(directory, "cases.json")));
  for (const page of [...new Set(set.cases.map(c => c.page).filter(Boolean))].sort()) hash.update(page).update(await readFile(join(directory, page)));
  return hash.digest("hex");
}
