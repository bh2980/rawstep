#!/usr/bin/env node
/** Opt-in screenshot sample using native OpenRouter decisions and inline state content. */
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { runCli } from '@rawstep/cli/cli';
import { readTrace } from '@rawstep/core/trace';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.argv[2] ?? 'cloudflare/clef-flash';
if (process.argv.length > 3 || !/^[a-z0-9._:-]+\/[a-z0-9._:-]+$/i.test(model))
  throw new Error('Usage: node scripts/try-openrouter.mjs [MODEL_ID]');
const browser = process.env.RAWSTEP_TEST_BROWSER_PATH ?? (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
// The runner creates this only after preflight; blocked setup leaves no empty artifact directory.
const out = resolve(root, '.rawstep', `openrouter-smoke-${randomUUID()}`);
console.log(`OpenRouter ${model} screenshot + keyboard sample. Screenshots are sent remotely. One browser; no VoiceOver or analysis LLM.`);
const code = await runCli(['screenshot-run', 'examples/screenshot/openrouter-task.json', '--decision', 'systemone',
  '--decision-provider', 'openrouter-systemone', '--decision-base-url', 'https://openrouter.ai/api/v1',
  '--decision-model', model, '--decision-inputs', 'text,image', '--allow-remote-model', '--out', out,
  ...(browser ? ['--browser-executable', browser] : [])], { cwd: root });
try {
  const trace = await readTrace(out);
  console.log(`Executed actions: ${trace.events.filter(event => event.type === 'action.result').length}`);
  if (trace.endedAt) await runCli(['report', out, '--out', out], { cwd: root });
} catch { console.log('No finalized trace was produced; setup may have failed before browser startup.'); }
process.exitCode = code;
