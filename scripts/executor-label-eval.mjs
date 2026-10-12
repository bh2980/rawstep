#!/usr/bin/env node
// Offline evaluation of how the executor's action choices are worded: the same screen reader states, built by walking the
// experiment pages with the simulated VoiceOver, are given to the decision model under several label variants, without running
// tasks. Each state has a right kind of answer: on the task's target, activate; anywhere else, move. Results go to
// <project>/.rawstep/label-eval/<timestamp>.json and a table on stdout.
//
// Usage: node scripts/executor-label-eval.mjs <project-dir> --env-file <path> [--per-page <n>]
// The project is examples/orchestration (its experiment.json tasks and their pages, its jev connection and executor).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover/backend';
import { DecisionClient, SystemOneChoiceModel } from '@rawstep/policies/systemone';
import { ACTION_ONLY_EXECUTOR_GUIDE } from '@rawstep/policies/policy';
import { DEFAULT_EXECUTOR_INSTRUCTIONS, parseConfig, resolveBaseURL } from '@rawstep/project/config';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const project = resolve(args[0] ?? 'examples/orchestration'), perPage = Number(flag('per-page') ?? 8);
const env = Object.fromEntries(readFileSync(flag('env-file'), 'utf8').split('\n').map(l => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(([, k, v]) => { try { return [k, v.startsWith('"') ? JSON.parse(v) : v]; } catch { return [k, v]; } }));
const config = parseConfig(JSON.parse(readFileSync(join(project, 'rawstep.config.json'), 'utf8')));
const connection = config.connections[0], executor = config.combos.find(c => c.id === 'jev-solo').executors.screenreader;
const client = new DecisionClient({ provider: connection.provider, baseURL: resolveBaseURL(connection), modelId: executor.modelId, apiKey: env.RAWSTEP_TYPESAFE_API_KEY,
  timeoutMs: 60000, capabilities: { inputs: ['text'], maxChoices: 255, maxImages: 0 } });

/** Per task: what to activate, and the L2 tasks (move to it, then press it) that frame the task context. */
const TARGETS = {
  'shop-cart': { targets: [{ match: 'Add to cart, button', press: "Press the 'Add to cart' button" }], move: "Move to the 'Add to cart' button", goalWords: ['phone', 'cart', 'add'] },
  'help-returns': { targets: [{ match: 'How do I return an item?', press: "Open the 'How do I return an item?' answer" }], move: "Move to the 'How do I return an item?' button", goalWords: ['return', 'help', 'item'] },
  'notify-orders': { targets: [{ match: 'Order updates, unchecked', press: "Check the 'Order updates' checkbox" }, { match: 'Save changes, button', press: "Press the 'Save changes' button" }],
    move: "Move to the 'Order updates' checkbox", goalWords: ['order', 'notification', 'email', 'settings', 'update'] },
};
const INTENTS = ['next', 'previous', 'activate', 'heading.next', 'heading.previous'];
const PLAIN = { next: 'Move to the next item', previous: 'Move to the previous item', 'heading.next': 'Jump to the next heading', 'heading.previous': 'Jump to the previous heading' };
const VARIANTS = {
  B_plain_state: { label: (intent) => intent === 'activate' ? 'Activate the current item' : PLAIN[intent], stateItem: true },
  B2_plain_nostate: { label: (intent) => intent === 'activate' ? 'Activate the current item' : PLAIN[intent], stateItem: false },
  D_effect_label: { label: (intent) => intent === 'activate' ? 'Activate the current item (presses or opens it)' : PLAIN[intent], stateItem: true },
  // Task context only: a task that only moves offers no activation (the plan would mark tasks as moving or pressing).
  E_task_gated: { label: (intent) => intent === 'activate' ? 'Activate the current item' : PLAIN[intent], stateItem: true, gated: true, contexts: ['task'] },
};

/** Every cursor stop on the task's page, moving item by item, with the speech heard so far. */
async function walk(browser, task) {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(join(project, task.url)).href);
  const backend = new MockVoiceOverBackend(); await backend.start(); backend.attachSession({ page });
  const stops = [], heard = [];
  let speech = (await backend.observe()).speech.filter(s => s.trim());
  for (let i = 0; i < 45; i++) {
    const item = speech.at(-1)?.trim();
    if (item) stops.push({ index: i, item, speech: [...speech], history: heard.slice(-6) });
    heard.push({ step: i + 1, decision: { action: { kind: 'intent', intent: 'next' } }, speech: [...speech] });
    await backend.execute({ kind: 'intent', intent: 'next' });
    speech = (await backend.observe()).speech.filter(s => s.trim());
    if (speech.some(s => /End of content/.test(s))) break;
  }
  await backend.close(); await page.close();
  return stops;
}
/** The target, the stops whose words overlap the goal (the lexical trap), and a spread of other stops up to `perPage`. */
function sample(stops, spec) {
  const targetOf = s => spec.targets.find(t => s.item.includes(t.match)), isTarget = s => !!targetOf(s);
  const overlap = s => !isTarget(s) && spec.goalWords.some(w => s.item.toLowerCase().includes(w));
  const target = spec.targets.map(t => stops.find(s => s.item.includes(t.match))).filter(Boolean).map(s => ({ ...s, press: targetOf(s).press })), traps = stops.filter(overlap);
  const others = stops.filter(s => !isTarget(s) && !overlap(s) && s.item !== '•' && s.item !== '1.' && s.item !== '2.' && s.item !== '3.');
  const step = Math.max(1, Math.floor(others.length / Math.max(1, perPage - traps.length)));
  return [...target.map(s => ({ ...s, kind: 'target' })), ...traps.map(s => ({ ...s, kind: 'trap' })), ...others.filter((_, i) => i % step === 0).slice(0, Math.max(0, perPage - traps.length)).map(s => ({ ...s, kind: 'other' }))];
}

await client.prepare({ signal: AbortSignal.timeout(60000) });
const browser = await chromium.launch();
const results = [];
for (const { id } of JSON.parse(readFileSync(join(project, 'experiment.json'), 'utf8')).tasks) {
  const task = JSON.parse(readFileSync(join(project, 'tasks', `${id}.json`), 'utf8')), spec = TARGETS[id];
  for (const stop of sample(await walk(browser, task), spec)) for (const [variant, v] of Object.entries(VARIANTS)) for (const context of v.contexts ?? ['solo', 'task']) {
    const moving = context === 'task' && stop.kind !== 'target';
    const choices = INTENTS.filter(intent => !(v.gated && moving && intent === 'activate')).map(intent => ({ id: `intent:${intent}`, label: v.label(intent, stop.item) }));
    const history = stop.history.map(h => ({ step: h.step, decision: h.decision, speech: h.speech }));
    const state = { goal: task.goal, speech: stop.speech, history, ...(v.stateItem ? { currentItem: stop.item } : {}),
      ...(context === 'task' ? { currentTask: { goal: stop.kind === 'target' ? stop.press : spec.move, actions: 0, actionLimit: 20 } } : {}) };
    const instructions = executor.instructions + (context === 'task' ? `\n${ACTION_ONLY_EXECUTOR_GUIDE}` : '');
    const model = new SystemOneChoiceModel(client, { id: `label-eval-${context}`, version: variant, instructions });
    try {
      const r = await model.choose({ state, choices }, { signal: AbortSignal.timeout(60000) });
      const p = r.probabilities ?? [], at = choices.findIndex(c => c.id === 'intent:activate'), activate = at >= 0 ? p[at] ?? 0 : 0;
      results.push({ task: id, item: stop.item, kind: stop.kind, variant, context, choice: r.choiceId, pActivate: activate, top: Math.max(...p) });
    } catch (error) { results.push({ task: id, item: stop.item, kind: stop.kind, variant, context, error: String(error?.message ?? error).slice(0, 120) }); }
    process.stdout.write('.');
  }
}
await browser.close();

const rate = (rows, f) => rows.length ? `${Math.round(rows.filter(f).length / rows.length * 100)}%` : '-';
const lines = ['| 문구 | 맥락 | 대상 위에서 누름 (높을수록 좋음) | 덫 링크에서 누름 (낮을수록 좋음) | 그 밖에서 누름 (낮을수록 좋음) | 대상 위 누르기 확률 평균 |', '|---|---|---|---|---|---|'];
for (const [variant, v] of Object.entries(VARIANTS)) for (const context of v.contexts ?? ['solo', 'task']) {
  const rows = results.filter(r => r.variant === variant && r.context === context && !r.error), is = kind => rows.filter(r => r.kind === kind);
  const mean = is('target').reduce((a, r) => a + r.pActivate, 0) / Math.max(1, is('target').length);
  lines.push(`| ${variant} | ${context} | ${rate(is('target'), r => r.choice === 'intent:activate')} (${is('target').length}) | ${rate(is('trap'), r => r.choice === 'intent:activate')} (${is('trap').length}) | ${rate(is('other'), r => r.choice === 'intent:activate')} (${is('other').length}) | ${mean.toFixed(2)} |`);
}
const out = join(project, '.rawstep', 'label-eval'); mkdirSync(out, { recursive: true });
const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ results }, null, 2));
console.log(`\n${lines.join('\n')}\n\nerrors: ${results.filter(r => r.error).length}\n${file}`);
