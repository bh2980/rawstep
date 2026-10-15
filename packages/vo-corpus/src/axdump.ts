/** Read-only native browser AX web-area snapshot. AX keyboard focus is not the VoiceOver reading cursor. */
import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  stringTruncations?: number;
  /** Child indices from the web area root to the focused element; null when focus is outside the web area. */
  focusedPath: number[] | null;
  root: AxNode;
}

/** AXFocused on a stale web node is insufficient: Safari can report actual focus in browser chrome. */
export function focusedAxNode(dump: AxDump): AxNode | undefined {
  if (!dump.focusedPath || dump.truncated) return undefined;
  let node: AxNode | undefined = dump.root;
  for (const index of dump.focusedPath) {
    if (!Number.isInteger(index) || index < 0) return undefined;
    node = node?.children?.[index];
    if (!node) return undefined;
  }
  return node;
}

/** Safari commonly exposes button names in AXTitle; Chrome uses AXDescription. Never use a control's value as its name. */
export function nativeNodeName(node:AxNode|undefined):string{
  return [node?.AXTitle,node?.AXDescription].find((v):v is string=>typeof v==='string'&&!!v.trim())?.trim()??'';
}

/** A retry has a new attempt ID; even repeated stages refuse to replace raw observations. */
export async function saveAxSnapshot(runDir:string,attemptId:string,stage:string,dump:AxDump):Promise<string> {
  if(!/^[\w-]+$/.test(attemptId)||!/^[\w.-]+$/.test(stage))throw new Error("Invalid AX snapshot identity");
  const directory=join('ax','attempts',attemptId);
  await mkdir(join(runDir,directory),{recursive:true});
  const relative=join(directory,stage+'.json');
  await writeFile(join(runDir,relative),JSON.stringify(dump),{flag:'wx'});
  return relative;
}

/** Exit code 2 (accessibility permission missing) and other failures throw with the dumper's message. */
export async function dumpAxTree(machine: Machine, app: string, options: { maxDepth?: number; maxNodes?: number; maxStringLength?: number; focusStartURL?: string } = {}): Promise<AxDump> {
  const args = ["--app", app];
  if (options.maxDepth) args.push("--max-depth", String(options.maxDepth));
  if (options.maxNodes) args.push("--max-nodes", String(options.maxNodes));
  if (options.maxStringLength) args.push("--max-string-length", String(options.maxStringLength));
  if (options.focusStartURL) args.push("--focus-start-url", options.focusStartURL);
  try {
    const stdout = await machine.exec(await machine.place(await ensureBinary()), args);
    return JSON.parse(stdout) as AxDump;
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    throw new Error(failure.stderr?.trim() || failure.message);
  }
}
