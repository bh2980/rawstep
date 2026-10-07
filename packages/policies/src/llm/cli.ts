import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Coding-agent CLIs as LLMs, signed in with the person's own account (ChatGPT for Codex, grok.com for Grok, Google for
 * Antigravity), so planning and analysis need no API key. Every call runs once and exits, in an empty temporary folder with
 * the CLI's sandbox and no web or file tools where the CLI allows it, so page text in the prompt cannot change files or reach
 * other tools. Each CLI is forced to answer in a JSON schema, and Rawstep validates the answer again with its own schema.
 * The CLI itself is the person's install: Rawstep only starts it.
 */
export type CliProvider = 'codex' | 'grok' | 'antigravity';
export type CliReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type CliModelOptions = {
  provider: CliProvider;
  /** Empty for the model the CLI itself would pick. */
  modelId: string;
  timeoutMs: number;
  reasoningEffort?: CliReasoningEffort;
  /** The program to run; tests point it at a fake. Default: the CLI's own command. */
  command?: string;
};
export type CliRequest = { system: string; user: string; schema: z.ZodType; signal: AbortSignal };
export type CliStatus = 'signed-in' | 'signed-out' | 'missing';
type Files = { dir: string; schema: string; prompt: string; answer: string };
type Driver = {
  command: string;
  args(options: CliModelOptions, files: Files, schema: Record<string, unknown>): string[];
  /** What the CLI reads on stdin; undefined when the prompt goes in a file. */
  stdin(prompt: string): string | undefined;
  /** The structured answer from what the CLI wrote. */
  answer(stdout: string, files: Files): Promise<unknown>;
  /** The models this sign-in can use; empty when unknown. */
  models(command: string): Promise<{ id: string; name: string }[]>;
};

const lastJsonLine = (text: string) => text.trim().split('\n').reverse().map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return undefined; } }).find(Boolean);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const CLI_DRIVERS: Record<CliProvider, Driver> = {
  codex: {
    command: 'codex',
    // --ignore-user-config leaves out the person's hooks, MCP servers and plugins; --ephemeral saves no session.
    args: (o, f) => ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', f.dir,
      ...(o.modelId ? ['-m', o.modelId] : []), ...(o.reasoningEffort ? ['-c', `model_reasoning_effort="${o.reasoningEffort}"`] : []),
      '--output-schema', f.schema, '-o', f.answer, '-'],
    stdin: prompt => prompt,
    answer: async (_stdout, f) => JSON.parse(await readFile(f.answer, 'utf8')),
    models: async () => {
      const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
      try {
        const cache = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')) as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[] };
        return (cache.models ?? []).filter(m => typeof m.slug === 'string' && m.visibility !== 'hide')
          .map(m => ({ id: m.slug as string, name: typeof m.display_name === 'string' ? m.display_name : m.slug as string }));
      } catch { return []; }
    },
  },
  grok: {
    command: 'grok',
    // One turn, no tools, no web search, no subagents. Grok keeps a session record of its own.
    args: (o, f, schema) => ['--prompt-file', f.prompt, '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--max-turns', '1', '--tools', '',
      '--disable-web-search', '--no-subagents', '--cwd', f.dir, ...(o.modelId ? ['-m', o.modelId] : []), ...(o.reasoningEffort ? ['--reasoning-effort', o.reasoningEffort] : [])],
    stdin: () => undefined,
    answer: async stdout => record(JSON.parse(stdout)).structuredOutput,
    models: async command => {
      const out = await capture(command, ['models']);
      return out === undefined ? [] : [...out.matchAll(/^\s+[*-]\s+(\S+)/gm)].map(m => ({ id: m[1]!, name: m[1]! }));
    },
  },
  antigravity: {
    command: 'agy',
    // The prompt arrives as one stream-json user message on stdin (arguments are too short for long prompts); `-p=` turns on print mode.
    args: (o, f) => ['--input-format', 'stream-json', '--output-format', 'stream-json', '--json-schema', f.schema, '--sandbox', '--disable-slash-commands',
      ...(o.modelId ? ['--model', o.modelId] : []), ...(o.reasoningEffort ? ['--effort', o.reasoningEffort] : []), '-p='],
    stdin: prompt => JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } }) + '\n',
    answer: async stdout => {
      const result = record(record(lastJsonLine(stdout)).result);
      if (result.status !== 'SUCCESS') throw new Error('antigravity failed');
      return result.structured_output;
    },
    models: async command => {
      const out = await capture(command, ['models']);
      return out === undefined ? [] : out.split('\n').map(line => line.split('\t')).filter(parts => parts.length === 2 && parts[0]!.trim()).map(([id, name]) => ({ id: id!.trim(), name: name!.trim() }));
    },
  },
};

/** Runs a short command and returns its stdout, or undefined when it cannot run or fails. */
function capture(command: string, args: string[], signal?: AbortSignal): Promise<string | undefined> {
  return new Promise(resolve => {
    let out = '';
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'ignore'], ...(signal ? { signal } : {}) });
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => resolve(undefined));
    child.on('close', code => resolve(code === 0 ? out : undefined));
  });
}

/**
 * The CLIs' structured output accepts strict schemas only: every property listed as required. Optional properties become
 * required-but-nullable here; `dropNulls` removes those nulls again before Rawstep's schema reads the answer.
 */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) if (key !== '$schema') out[key] = visit(value);
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      const required = new Set(Array.isArray(out.required) ? out.required as string[] : []);
      const properties = out.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(properties)) if (!required.has(key)) properties[key] = { anyOf: [value, { type: 'null' }] };
      out.required = Object.keys(properties); out.additionalProperties = false;
    }
    return out;
  };
  return visit(z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })) as Record<string, unknown>;
}
/** Removes object keys whose value is null (the stand-in for a left-out optional field). */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]));
}

/** Runs one CLI call and returns the validated object. Any failure throws a plain Error; callers map it to a fixed message. */
export async function cliStructured<T>(options: CliModelOptions, request: CliRequest & { schema: z.ZodType<T> }): Promise<T> {
  const driver = CLI_DRIVERS[options.provider];
  const dir = await mkdtemp(join(tmpdir(), `rawstep-${options.provider}-`));
  const files: Files = { dir, schema: join(dir, 'schema.json'), prompt: join(dir, 'prompt.txt'), answer: join(dir, 'answer.json') };
  try {
    const schema = strictJsonSchema(request.schema);
    // The rules come first, then the request; nothing in the request is a command for the shell.
    const prompt = `${request.system}\n\nAnswer only with the JSON object. Do not run commands, read files or browse: everything you need is below.\n\n${request.user}`;
    await writeFile(files.schema, JSON.stringify(schema));
    const input = driver.stdin(prompt);
    if (input === undefined) await writeFile(files.prompt, prompt);
    const stdout = await new Promise<string>((resolve, reject) => {
      let out = '';
      const child = spawn(options.command ?? driver.command, driver.args({ ...options, modelId: options.modelId.trim() }, files, schema), { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'], signal: request.signal });
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${options.provider} exited with ${code}`)));
      child.stdin.end(input ?? '');
    });
    return request.schema.parse(dropNulls(await driver.answer(stdout, files)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The models a CLI offers this sign-in; empty when it cannot say. */
export const listCliModels = (provider: CliProvider, command = CLI_DRIVERS[provider].command): Promise<{ id: string; name: string }[]> => CLI_DRIVERS[provider].models(command);
/**
 * Whether the CLI is installed and signed in: `codex login status`, or for Grok and Antigravity their model list, which needs
 * a sign-in. Asks no model anything.
 */
export async function cliStatus(provider: CliProvider, command = CLI_DRIVERS[provider].command, signal?: AbortSignal): Promise<CliStatus> {
  return new Promise(resolve => {
    const child = spawn(command, provider === 'codex' ? ['login', 'status'] : ['models'], { cwd: tmpdir(), stdio: 'ignore', ...(signal ? { signal } : {}) });
    child.on('error', () => resolve('missing'));
    child.on('close', code => resolve(code === 0 ? 'signed-in' : 'signed-out'));
  });
}
