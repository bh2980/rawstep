#!/usr/bin/env node
// Runs an orchestration experiment — every task × model combo × repeat through `rawstep run` — and tabulates the runs from their
// traces: did the run reach the goal, how many actions against the shortest known path, how the executor and the plan behaved.
// The experiment is described by <project>/experiment.json (tasks with their shortest paths, combos, repeats); see
// examples/orchestration. Results go to <project>/.rawstep/experiments-cli/<timestamp>/ (summary.md, summary.json, one folder per run).
//
// Usage: node scripts/orchestration-experiment.mjs <project-dir> [--repeat <n>] [--tasks a,b] [--combos x,y] [--env-file <path>] [--summarize <dir>]
// --env-file reads KEY=value lines (e.g. a .env.local elsewhere) into the runs' environment without copying the file.
// --summarize only tabulates an existing results folder.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const project = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const spec = JSON.parse(readFileSync(join(project, 'experiment.json'), 'utf8'));
const pick = (list, value) => value ? list.filter(item => value.split(',').includes(item.id ?? item)) : list;
const tasks = pick(spec.tasks, flag('tasks')), combos = pick(spec.combos, flag('combos')), repeat = Number(flag('repeat') ?? spec.repeat ?? 1);
const cli = resolve(import.meta.dirname, '../packages/cli/dist/cli/bin.js');

function envFrom(path) {
  if (!path) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').map(line => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())).filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')]).filter(([, value]) => value));
}

const runOnce = (task, combo, out, env) => new Promise(done => {
  const child = spawn(process.execPath, [cli, 'run', task.id, '--combo', combo, '--mode', 'screenreader', '--repeat', String(repeat), '--out', out, '--project', project],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  child.on('close', code => { writeFileSync(join(out, 'cli.log'), log); done(code); });
});

/** One run's numbers, read from its trace. Evidence kinds come from the orchestrated policy (policies/src/policy/orchestration.ts). */
function measure(dir) {
  const trace = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  const evidence = trace.events.filter(e => e.type === 'policy.evidence').flatMap(e => [e.data?.evidence].flat()).filter(Boolean);
  const executor = evidence.filter(e => e.kind === 'model-inference' && (e.role === 'executor' || !e.role));
  const plans = evidence.filter(e => e.kind === 'orchestration-plan');
  const confidence = executor.map(e => {
    const p = e.probabilities?.map(v => typeof v === 'number' ? v : v.probability); if (!p || p.length < 2) return undefined;
    const u = 1 / p.length; return (Math.max(...p) - u) / (1 - u);
  }).filter(v => v !== undefined).sort((a, b) => a - b);
  const finalPlan = plans.at(-1)?.document;
  const taskList = finalPlan ? [...finalPlan.phases.flatMap(p => p.tasks), ...finalPlan.retired] : [];
  const actions = trace.events.filter(e => e.type === 'action.result').length;
  return {
    outcome: trace.outcome?.status ?? 'unknown', reason: trace.outcome?.reason, actions,
    executorCalls: executor.length,
    medianConfidence: confidence.length ? confidence[Math.floor(confidence.length / 2)] : undefined,
    replans: plans.filter(p => !['start', 'checkpoint'].includes(p.trigger)).map(p => p.trigger),
    cueCompletions: evidence.filter(e => e.kind === 'orchestration-cue').length,
    tasksDone: taskList.filter(t => t.status === 'done').length, tasksAbandoned: taskList.filter(t => t.status === 'abandoned' || t.status === 'failed').length, tasksTotal: taskList.length,
  };
}

function summarize(root) {
  const rows = [];
  for (const task of tasks) for (const combo of combos) {
    const base = join(root, task.id, combo);
    if (!existsSync(base)) continue;
    for (const run of readdirSync(base).filter(name => name.startsWith('run-')).sort()) {
      try { rows.push({ task: task.id, combo, run, minimal: task.minimal, ...measure(join(base, run)) }); }
      catch { rows.push({ task: task.id, combo, run, outcome: 'no-trace' }); }
    }
  }
  const pct = (n, d) => d ? `${Math.round(n / d * 100)}%` : '-';
  const groups = [];
  for (const task of tasks) for (const combo of combos) {
    const runs = rows.filter(r => r.task === task.id && r.combo === combo);
    if (!runs.length) continue;
    const ok = runs.filter(r => r.outcome === 'success');
    const avg = key => { const v = runs.map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : undefined; };
    groups.push({ task: task.id, combo, runs: runs.length, success: pct(ok.length, runs.length),
      actions: avg('actions')?.toFixed(1), detour: ok.length && task.minimal ? (ok.reduce((a, r) => a + r.actions, 0) / ok.length / task.minimal).toFixed(2) : '-',
      replans: (runs.reduce((a, r) => a + (r.replans?.length ?? 0), 0) / runs.length).toFixed(1),
      abandoned: (runs.reduce((a, r) => a + (r.tasksAbandoned ?? 0), 0) / runs.length).toFixed(1),
      confidence: avg('medianConfidence')?.toFixed(2) ?? '-' });
  }
  const table = ['| 작업 | 모델 조합 | 실행 | 목표 도달 | 평균 행동 | 우회 비율(성공 평균/최소) | 재계획 | 포기한 작업 | 확신도 중앙값 |', '|---|---|---|---|---|---|---|---|---|',
    ...groups.map(g => `| ${g.task} | ${g.combo} | ${g.runs} | ${g.success} | ${g.actions ?? '-'} | ${g.detour} | ${g.replans} | ${g.abandoned} | ${g.confidence} |`)].join('\n');
  writeFileSync(join(root, 'summary.json'), JSON.stringify({ spec: { tasks, combos, repeat }, groups, rows }, null, 2));
  writeFileSync(join(root, 'summary.md'), `# 실험 결과\n\n${table}\n`);
  console.log(table);
}

const existing = flag('summarize');
if (existing) summarize(resolve(existing));
else {
  const root = join(project, '.rawstep', 'experiments-cli', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(root, { recursive: true });
  const env = envFrom(flag('env-file'));
  // One run at a time: browsers and models are not shared, and the machine's memory is limited.
  for (const task of tasks) for (const combo of combos) {
    const out = join(root, task.id, combo);
    mkdirSync(out, { recursive: true });
    process.stdout.write(`${task.id} × ${combo} × ${repeat}… `);
    const code = await runOnce(task, combo, out, env);
    console.log(code === 0 ? 'done' : `exit ${code} (see cli.log)`);
  }
  summarize(root);
  console.log(`\n${root}`);
}
