#!/usr/bin/env node
// Runs an orchestration experiment — every task × model combo × repeat through `rawstep run` — and tabulates the runs from their
// traces: did the run reach the goal, how many actions against the shortest known path, how the executor and the plan behaved.
// The experiment is described by <project>/experiment.json (tasks with their shortest paths, combos, repeats); see
// examples/orchestration. Results go to <project>/.rawstep/experiments-cli/<timestamp>/ (summary.md, summary.json, one folder per run).
//
// Usage: node scripts/orchestration-experiment.mjs <project-dir> [--spec <file>] [--into <dir>] [--repeat <n>] [--tasks a,b] [--combos x,y] [--env-file <path>]
//          [--summarize <dir>] [--retry-errors <dir>]
// --env-file reads KEY=value lines (e.g. a .env.local elsewhere) into the runs' environment without copying the file.
// --summarize only tabulates an existing results folder; --retry-errors reruns only its runs that ended in an error, then tabulates.
// A run that ends in an error (a model API call failing, a browser that would not start) says nothing about the executor: it is
// counted apart from failures, left out of the success rate, and retried once.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const project = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const spec = JSON.parse(readFileSync(join(project, flag('spec') ?? 'experiment.json'), 'utf8'));
const pick = (list, value) => value ? list.filter(item => value.split(',').includes(item.id ?? item)) : list;
const tasks = pick(spec.tasks, flag('tasks')), combos = flag('combos') ? flag('combos').split(',') : spec.combos, repeat = Number(flag('repeat') ?? spec.repeat ?? 1);
const cli = resolve(import.meta.dirname, '../packages/cli/dist/cli/bin.js');

function envFrom(path) {
  if (!path) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').map(line => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())).filter(Boolean)
    .map(([, key, value]) => { try { return [key, value.startsWith('"') ? JSON.parse(value) : value]; } catch { return [key, value]; } }).filter(([, value]) => value));
}

/** A condition is a model combo id, or `preset:<id>` for a preset (combo, action set and run rules together). */
const conditionArgs = condition => condition.startsWith('preset:') ? ['--preset', condition.slice(7)] : ['--combo', condition];
const runOnce = (task, combo, out, env, times = repeat) => new Promise(done => {
  const child = spawn(process.execPath, [cli, 'run', task.id, ...conditionArgs(combo), '--mode', 'screenreader', '--repeat', String(times), '--out', out, '--project', project],
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
  // Task outcomes from the task events: the last plan document is written before later tasks finish.
  const ends = new Map(evidence.filter(e => e.kind === 'orchestration-task').map(e => [e.taskId, e.toStatus]));
  const taskIds = new Set(plans.flatMap(p => p.document ? [...p.document.phases.flatMap(ph => ph.tasks), ...p.document.retired].map(t => t.id) : []));
  const actions = trace.events.filter(e => e.type === 'action.result').length;
  return {
    outcome: trace.outcome?.reason === 'error' ? 'error' : trace.outcome?.status ?? 'unknown', reason: trace.outcome?.reason,
    ...(trace.outcome?.reason === 'error' ? { error: String(trace.outcome?.error ?? '').slice(0, 160) } : {}), actions,
    executorCalls: executor.length,
    medianConfidence: confidence.length ? confidence[Math.floor(confidence.length / 2)] : undefined,
    replans: plans.filter(p => !['start', 'checkpoint'].includes(p.trigger)).map(p => p.trigger),
    cueCompletions: evidence.filter(e => e.kind === 'orchestration-cue' && e.verified === 'heard').length,
    // Items heard in other words than the cue, put to the planner, and how many it recognised as the task's target.
    cueQuestions: evidence.filter(e => e.kind === 'orchestration-cue' && e.source === 'planner').length,
    cueRecognized: evidence.filter(e => e.kind === 'orchestration-cue' && e.verified === 'recognized').length,
    tasksDone: [...ends.values()].filter(status => status === 'done').length, tasksAbandoned: [...ends.values()].filter(status => status === 'abandoned' || status === 'failed').length, tasksTotal: taskIds.size,
  };
}

function summarize(root) {
  const rows = [];
  for (const task of tasks) for (const combo of combos) {
    const base = join(root, task.id, combo.replace(":", "-"));
    if (!existsSync(base)) continue;
    for (const run of readdirSync(base).filter(name => /^run-\d+$/.test(name)).sort()) {
      try { rows.push({ task: task.id, combo, run, minimal: task.minimal, ...measure(join(base, run)) }); }
      catch { rows.push({ task: task.id, combo, run, outcome: 'no-trace' }); }
    }
  }
  const pct = (n, d) => d ? `${Math.round(n / d * 100)}%` : '-';
  const groups = [];
  for (const task of tasks) for (const combo of combos) {
    const all = rows.filter(r => r.task === task.id && r.combo === combo);
    if (!all.length) continue;
    // Errors say nothing about the executor: they are counted, never averaged in.
    const runs = all.filter(r => r.outcome !== 'error' && r.outcome !== 'no-trace'), errors = all.length - runs.length;
    const ok = runs.filter(r => r.outcome === 'success');
    const avg = key => { const v = runs.map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : undefined; };
    groups.push({ task: task.id, combo, runs: runs.length, errors, success: runs.length ? `${ok.length}/${runs.length}` : '-',
      actions: avg('actions')?.toFixed(1), detour: ok.length && task.minimal ? (ok.reduce((a, r) => a + r.actions, 0) / ok.length / task.minimal).toFixed(2) : '-',
      replans: runs.length ? (runs.reduce((a, r) => a + (r.replans?.length ?? 0), 0) / runs.length).toFixed(1) : '-',
      abandoned: runs.length ? (runs.reduce((a, r) => a + (r.tasksAbandoned ?? 0), 0) / runs.length).toFixed(1) : '-',
      confidence: avg('medianConfidence')?.toFixed(2) ?? '-' });
  }
  const table = ['| 작업 | 모델 조합 | 목표 도달 (오류 제외) | 오류 | 평균 행동 | 우회 비율(성공 평균/최소) | 재계획 | 포기한 작업 | 확신도 중앙값 |', '|---|---|---|---|---|---|---|---|---|',
    ...groups.map(g => `| ${g.task} | ${g.combo} | ${g.success} | ${g.errors} | ${g.actions ?? '-'} | ${g.detour} | ${g.replans} | ${g.abandoned} | ${g.confidence} |`)].join('\n');
  writeFileSync(join(root, 'summary.json'), JSON.stringify({ spec: { tasks, combos, repeat }, groups, rows }, null, 2));
  writeFileSync(join(root, 'summary.md'), `# 실험 결과\n\n${table}\n`);
  console.log(table);
}

/** Reruns, once each, the runs of a results folder that ended in an error, putting each new run in the old one's place. */
async function retryErrors(root, env) {
  for (const task of tasks) for (const combo of combos) {
    const base = join(root, task.id, combo.replace(":", "-"));
    if (!existsSync(base)) continue;
    for (const run of readdirSync(base).filter(name => /^run-\d+$/.test(name)).sort()) {
      let errored = false;
      try { errored = measure(join(base, run)).outcome === 'error'; } catch { errored = true; }
      if (!errored) continue;
      const scratch = join(base, `${run}.retry`);
      rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
      process.stdout.write(`retry ${task.id} × ${combo} ${run}… `);
      const code = await runOnce(task, combo, scratch, env, 1);
      if (existsSync(join(scratch, 'run-1', 'trace.json'))) {
        renameSync(join(base, run), join(base, `${run}.error`));
        renameSync(join(scratch, 'run-1'), join(base, run));
      }
      rmSync(scratch, { recursive: true, force: true });
      console.log(code === 0 ? 'done' : `exit ${code}`);
    }
  }
}

const existing = flag('summarize'), retry = flag('retry-errors');
if (existing) summarize(resolve(existing));
else if (retry) { await retryErrors(resolve(retry), envFrom(flag('env-file'))); summarize(resolve(retry)); }
else {
  // --into continues an earlier results folder: conditions that already have runs there are skipped.
  const root = flag('into') ? resolve(flag('into')) : join(project, '.rawstep', 'experiments-cli', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(root, { recursive: true });
  const env = envFrom(flag('env-file'));
  // One run at a time: browsers and models are not shared, and the machine's memory is limited.
  for (const task of tasks) for (const combo of combos) {
    const out = join(root, task.id, combo.replace(":", "-"));
    if (existsSync(out) && readdirSync(out).some(name => /^run-\d+$/.test(name))) { console.log(`${task.id} × ${combo}: already run, skipped`); continue; }
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    process.stdout.write(`${task.id} × ${combo} × ${repeat}… `);
    const code = await runOnce(task, combo, out, env);
    console.log(code === 0 ? 'done' : `exit ${code} (see cli.log)`);
  }
  await retryErrors(root, env);
  summarize(root);
  console.log(`\n${root}`);
}
