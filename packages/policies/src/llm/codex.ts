import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Codex CLI as an LLM: `codex exec` with the person's own ChatGPT sign-in, so planning and analysis need no API key. Each call
 * runs in an empty temporary folder with a read-only sandbox, the person's Codex config (hooks, MCP servers, plugins) ignored
 * and no session saved, so page text in the prompt cannot change files or reach other tools. The answer is forced into a
 * JSON schema and validated again by Rawstep's own schema.
 */
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type CodexModelOptions = {
  /** Empty for the model Codex itself would pick. */
  modelId: string;
  timeoutMs: number;
  reasoningEffort?: CodexReasoningEffort;
  /** The program to run; tests point it at a fake. Default `codex`. */
  command?: string;
};
export type CodexRequest = { system: string; user: string; schema: z.ZodType; signal: AbortSignal };

/**
 * Codex's structured output accepts only strict schemas: every property listed as required. Optional properties become
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

/** Runs one `codex exec` call and returns the validated object. Any failure throws a plain Error; callers map it to a fixed message. */
export async function codexStructured<T>(options: CodexModelOptions, request: CodexRequest & { schema: z.ZodType<T> }): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-codex-'));
  try {
    await writeFile(join(dir, 'schema.json'), JSON.stringify(strictJsonSchema(request.schema)));
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', dir,
      ...(options.modelId.trim() ? ['-m', options.modelId.trim()] : []),
      ...(options.reasoningEffort ? ['-c', `model_reasoning_effort="${options.reasoningEffort}"`] : []),
      '--output-schema', join(dir, 'schema.json'), '-o', join(dir, 'answer.json'), '-'];
    // The rules come first, then the request; nothing in the request is a command for the shell.
    const prompt = `${request.system}\n\nAnswer only with the JSON object. Do not run commands or read files: everything you need is below.\n\n${request.user}`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.command ?? 'codex', args, { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'], signal: request.signal });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`codex exited with ${code}`)));
      child.stdin.end(prompt);
    });
    return request.schema.parse(dropNulls(JSON.parse(await readFile(join(dir, 'answer.json'), 'utf8'))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The models Codex lists for this sign-in, from its own model cache; empty when Codex has not cached any yet. */
export async function listCodexModels(home = process.env.CODEX_HOME ?? join(homedir(), '.codex')): Promise<{ id: string; name: string }[]> {
  try {
    const cache = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')) as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[] };
    return (cache.models ?? []).filter(m => typeof m.slug === 'string' && m.visibility !== 'hide')
      .map(m => ({ id: m.slug as string, name: typeof m.display_name === 'string' ? m.display_name : m.slug as string }));
  } catch { return []; }
}
/** Whether Codex is installed and signed in (`codex login status`). */
export async function codexLoginStatus(command = 'codex', signal?: AbortSignal): Promise<'signed-in' | 'signed-out' | 'missing'> {
  return new Promise(resolve => {
    const child = spawn(command, ['login', 'status'], { stdio: 'ignore', ...(signal ? { signal } : {}) });
    child.on('error', () => resolve('missing'));
    child.on('close', code => resolve(code === 0 ? 'signed-in' : 'signed-out'));
  });
}
