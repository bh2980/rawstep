import { appendFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Where a run's evidence goes. The recorder stays synchronous per event (an append failure stops the run). */
export interface TraceSink {
  /** Called once before any event. A file sink refuses to replace an existing trace. */
  initialize(trace: unknown): Promise<void>;
  appendEvent(event: unknown): void;
  finalize(trace: unknown): Promise<void>;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

/** trace.json + append-only trace.jsonl journal next to it. */
export class FileTraceSink implements TraceSink {
  constructor(readonly dir: string) {}
  async initialize(trace: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // A reused output directory must never silently replace a previous run.
    await writeFile(join(this.dir, "trace.json"), JSON.stringify(trace, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(join(this.dir, "trace.jsonl"), "", { flag: "wx", mode: 0o600 });
  }
  appendEvent(event: unknown): void {
    appendFileSync(join(this.dir, "trace.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 });
  }
  async finalize(trace: unknown): Promise<void> {
    await writeJsonAtomic(join(this.dir, "trace.json"), trace);
  }
}

/** Keeps everything in memory, for tests and embedding without a filesystem. */
export class MemoryTraceSink implements TraceSink {
  trace?: unknown;
  readonly events: unknown[] = [];
  async initialize(trace: unknown): Promise<void> {
    if (this.trace !== undefined) throw new Error("Memory trace sink already holds a run.");
    this.trace = structuredClone(trace);
  }
  appendEvent(event: unknown): void { this.events.push(structuredClone(event)); }
  async finalize(trace: unknown): Promise<void> { this.trace = structuredClone(trace); }
}
