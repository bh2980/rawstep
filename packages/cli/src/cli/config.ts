import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { VercelEvaluationClient, SystemOneHttpClient, OpenRouterSystemOneClient, type SystemOneClient, type SystemOneInput } from '@rawstep/policies/systemone';
import type { CliArguments } from './args.js';

export type CliEnvironment = Record<string, string | undefined>;
/** Never mutates process.env or writes files; only RAWSTEP_DECISION_* and RAWSTEP_ANALYSIS_* are read. */
export async function loadCliEnvironment(cwd: string, environment: CliEnvironment = process.env): Promise<CliEnvironment> {
  let result: CliEnvironment = {};
  for (const name of ['.env', '.env.local']) {
    try { result = { ...result, ...parseEnv(await readFile(resolve(cwd, name), 'utf8')) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read or parse ${name}; contents omitted for privacy.`); }
  }
  for (const [key, value] of Object.entries(environment)) if (value !== undefined) result[key] = value;
  return Object.fromEntries(Object.entries(result).filter(([key]) => /^RAWSTEP_(DECISION|ANALYSIS)_/.test(key)));
}
function setting(args: CliArguments, env: CliEnvironment, namespace: 'decision' | 'analysis', field: string): string | undefined {
  const value = args.options[`${namespace}-${field.toLowerCase().replaceAll('_', '-')}`];
  return typeof value === 'string' ? value : env[`RAWSTEP_${namespace.toUpperCase()}_${field}`];
}
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required for the selected model connection.`);
  return value;
}
export function decisionConfig(args: CliArguments, env: CliEnvironment) {
  const provider = required(setting(args, env, 'decision', 'PROVIDER'), 'RAWSTEP_DECISION_PROVIDER');
  if (!['vercel-evaluation', 'systemone-http', 'openrouter-systemone'].includes(provider)) throw new Error('RAWSTEP_DECISION_PROVIDER must be vercel-evaluation, systemone-http, or openrouter-systemone; put URLs in RAWSTEP_DECISION_BASE_URL.');
  const inputsValue = setting(args, env, 'decision', 'INPUTS') ?? (provider === 'vercel-evaluation' ? 'text' : undefined);
  const inputs = required(inputsValue, 'RAWSTEP_DECISION_INPUTS').split(',').map(v => v.trim()) as SystemOneInput[];
  if (!inputs.includes('text') || inputs.some(v => !['text', 'image'].includes(v)) || new Set(inputs).size !== inputs.length) throw new Error('Decision inputs must be text or text,image.');
  if (provider === 'vercel-evaluation' && inputs.includes('image')) throw new Error('This Gateway evaluation adapter supports text only; choose an explicitly multimodal SystemOne connection for screenshots.');
  return { provider, inputs,
    baseURL: required(setting(args, env, 'decision', 'BASE_URL'), 'RAWSTEP_DECISION_BASE_URL'),
    model: required(setting(args, env, 'decision', 'MODEL'), 'RAWSTEP_DECISION_MODEL'),
    // A one-off provider override must never send the saved TypeSafe credential to OpenRouter.
    apiKey: provider === 'openrouter-systemone'
      ? env.RAWSTEP_DECISION_OPENROUTER_API_KEY ?? (env.RAWSTEP_DECISION_PROVIDER === provider ? env.RAWSTEP_DECISION_API_KEY : undefined)
      : env.RAWSTEP_DECISION_API_KEY,
  };
}
export type DecisionConfig = ReturnType<typeof decisionConfig>;
export function createDecisionClient(config: DecisionConfig): SystemOneClient {
  if (config.provider === 'vercel-evaluation') return new VercelEvaluationClient(config);
  const options = { ...config, capabilities: { inputs: config.inputs, maxChoices: 255, maxImages: config.inputs.includes('image') ? 2 : 0 } };
  return config.provider === 'openrouter-systemone' ? new OpenRouterSystemOneClient(options) : new SystemOneHttpClient(options);
}
export function analysisConfig(args: CliArguments, env: CliEnvironment) {
  if (required(setting(args, env, 'analysis', 'PROVIDER'), 'RAWSTEP_ANALYSIS_PROVIDER') !== 'openai-compatible') throw new Error('RAWSTEP_ANALYSIS_PROVIDER must be openai-compatible.');
  return { baseURL: required(setting(args, env, 'analysis', 'BASE_URL'), 'RAWSTEP_ANALYSIS_BASE_URL'),
    model: required(setting(args, env, 'analysis', 'MODEL'), 'RAWSTEP_ANALYSIS_MODEL'), apiKey: env.RAWSTEP_ANALYSIS_API_KEY };
}
