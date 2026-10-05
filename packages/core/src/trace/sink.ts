import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Where a run's evidence goes. The recorder stays synchronous per event (an append failure stops the run);
 * PNG screenshots are stored once per distinct image as blobs, and events keep a small reference.
 */
export interface TraceSink {
  /** Called once before any event. A file sink refuses to replace an existing trace. */
  initialize(trace: unknown): Promise<void>;
  appendEvent(event: unknown): void;
  /** Idempotent: the same name always holds the same bytes (names are content hashes). */
  putBlob(name: string, bytes: Uint8Array): void;
  readBlob(name: string): Promise<Uint8Array | undefined>;
  finalize(trace: unknown): Promise<void>;
}

const BLOB_NAME = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/;
function blobPath(dir: string, name: string): string {
  if (!BLOB_NAME.test(name)) throw new Error(`Invalid trace blob name ${name}.`);
  return join(dir, name);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

/** trace.json + append-only trace.jsonl journal + blobs/ next to them. */
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
  putBlob(name: string, bytes: Uint8Array): void {
    const path = blobPath(this.dir, name);
    mkdirSync(dirname(path), { recursive: true });
    try { writeFileSync(path, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as { code?: string }).code !== "EEXIST") throw error; }
  }
  async readBlob(name: string): Promise<Uint8Array | undefined> {
    try { return await readFile(blobPath(this.dir, name)); } catch { return undefined; }
  }
  async finalize(trace: unknown): Promise<void> {
    await writeJsonAtomic(join(this.dir, "trace.json"), trace);
  }
}

/** Keeps everything in memory, for tests and embedding without a filesystem. */
export class MemoryTraceSink implements TraceSink {
  trace?: unknown;
  readonly events: unknown[] = [];
  readonly blobs = new Map<string, Uint8Array>();
  async initialize(trace: unknown): Promise<void> {
    if (this.trace !== undefined) throw new Error("Memory trace sink already holds a run.");
    this.trace = structuredClone(trace);
  }
  appendEvent(event: unknown): void { this.events.push(structuredClone(event)); }
  putBlob(name: string, bytes: Uint8Array): void { if (!BLOB_NAME.test(name)) throw new Error(`Invalid trace blob name ${name}.`); if (!this.blobs.has(name)) this.blobs.set(name, new Uint8Array(bytes)); }
  async readBlob(name: string): Promise<Uint8Array | undefined> { return this.blobs.get(name); }
  async finalize(trace: unknown): Promise<void> { this.trace = structuredClone(trace); }
}

/** A screenshot stored as a blob: the event keeps its hash, size and any sibling fields such as viewport. */
export type ScreenshotRef = { sha256: string; blob: string; bytes: number; [key: string]: unknown };
const PNG_SIGNATURE = "89504e470d0a1a0a";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isScreenshotRef(value: unknown): value is ScreenshotRef {
  return record(value) && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256)
    && value.blob === `blobs/${value.sha256}.png` && Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0;
}
function inlinePng(value: unknown): Buffer | undefined {
  if (!record(value) || typeof value.pngBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.pngBase64)) return undefined;
  const bytes = Buffer.from(value.pngBase64, "base64");
  return bytes.subarray(0, 8).toString("hex") === PNG_SIGNATURE ? bytes : undefined;
}
/** SHA-256 of the PNG bytes, from a blob reference or an inline (schema 2.0/2.1) screenshot. */
export function screenshotSha256(value: unknown): string | undefined {
  if (isScreenshotRef(value)) return value.sha256;
  const bytes = inlinePng(value);
  return bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
}

/** Replaces every inline PNG screenshot with a blob reference. Returns a copy and the JSON paths of the references. */
export function extractScreenshots(value: unknown, put: (name: string, bytes: Uint8Array) => void): { value: unknown; paths: (string | number)[][] } {
  const paths: (string | number)[][] = [];
  const walk = (node: unknown, path: (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((child, index) => walk(child, [...path, index]));
    if (!record(node)) return node;
    const bytes = inlinePng(node);
    if (bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex"), blob = `blobs/${sha256}.png`;
      put(blob, bytes);
      paths.push(path);
      const { pngBase64: _inline, ...rest } = node;
      return { ...structuredClone(rest), sha256, blob, bytes: bytes.length };
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child, [...path, key])]));
  };
  return { value: walk(value, []), paths };
}

/** A copy of the trace where blob references also carry `pngBase64`, for code that needs pixels. Missing blobs stay references. */
export async function hydrateScreenshots<T>(trace: T, source: string | Pick<TraceSink, "readBlob">): Promise<T> {
  const sink = typeof source === "string" ? new FileTraceSink(source) : source;
  const walk = async (node: unknown): Promise<unknown> => {
    if (Array.isArray(node)) return Promise.all(node.map(walk));
    if (!record(node)) return node;
    if (isScreenshotRef(node)) {
      const bytes = await sink.readBlob(node.blob);
      return bytes && createHash("sha256").update(bytes).digest("hex") === node.sha256 ? { ...node, pngBase64: Buffer.from(bytes).toString("base64") } : { ...node };
    }
    return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([key, child]) => [key, await walk(child)] as const)));
  };
  return walk(structuredClone(trace)) as Promise<T>;
}
