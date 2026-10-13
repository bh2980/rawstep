/** Native macOS accessibility tree of a browser's web area: the tree VoiceOver speaks from. Read-only, never activates the app. */
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Machine } from "./host.js";

const run = promisify(execFile);
const source = fileURLToPath(new URL("../axdump/axdump.swift", import.meta.url));
const binary = fileURLToPath(new URL("../data/bin/axdump", import.meta.url));

async function modified(path: string): Promise<number | undefined> {
  try { return (await stat(path)).mtimeMs; } catch { return undefined; }
}

/** Compiles the Swift source into data/bin once, and again when the source is newer. */
async function ensureBinary(): Promise<string> {
  const [built, edited] = [await modified(binary), await modified(source)];
  if (built === undefined || (edited !== undefined && edited > built)) {
    await mkdir(fileURLToPath(new URL("../data/bin/", import.meta.url)), { recursive: true });
    await run("swiftc", ["-O", source, "-o", binary]);
  }
  return binary;
}

export interface AxNode {
  AXRole?: string;
  children?: AxNode[];
  childrenTruncated?: number;
  [attribute: string]: unknown;
}

export interface AxDump {
  app: string;
  pid: number;
  windowTitle: string;
  timestamp: string;
  nodeCount: number;
  truncated: boolean;
  /** Child indices from the web area root to the focused element; null when focus is outside the web area. */
  focusedPath: number[] | null;
  root: AxNode;
}

/** Exit code 2 (accessibility permission missing) and other failures throw with the dumper's message. */
export async function dumpAxTree(machine: Machine, app: string, options: { maxDepth?: number; maxNodes?: number } = {}): Promise<AxDump> {
  const args = ["--app", app];
  if (options.maxDepth) args.push("--max-depth", String(options.maxDepth));
  if (options.maxNodes) args.push("--max-nodes", String(options.maxNodes));
  try {
    const stdout = await machine.exec(await machine.place(await ensureBinary()), args);
    return JSON.parse(stdout) as AxDump;
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    throw new Error(failure.stderr?.trim() || failure.message);
  }
}
